//! Analyse antivirus des fichiers envoyés en clair (audit 2026-10-12, amélioration n° 19).
//!
//! Facultatif : actif si `CLAMAV_ADDR` est défini (`tcp:127.0.0.1:3310` ou `unix:/run/clamav/clamd.ctl`).
//! Concerne les fichiers que le serveur peut lire : avatars, bannières, icônes, émojis,
//! autocollants, sons. Les pièces jointes des messages sont chiffrées de bout en bout : un
//! antivirus n'y verrait que du bruit, c'est l'appareil du destinataire qui les ouvre.
//! clamd injoignable : envoi accepté avec un avertissement dans les journaux, sauf si
//! `CLAMAV_REQUIRED=true` (envoi refusé).
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::error::{AppError, Result};

const CHUNK: usize = 64 * 1024;
const TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, PartialEq)]
pub enum Verdict {
    Clean,
    Infected(String),
}

/// Lit la réponse clamd (`stream: OK` ou `stream: <nom> FOUND`).
pub fn parse_reply(reply: &str) -> std::result::Result<Verdict, String> {
    let r = reply.trim_end_matches(['\0', '\n']).trim();
    let body = r.strip_prefix("stream:").map(str::trim).unwrap_or(r);
    if body == "OK" {
        return Ok(Verdict::Clean);
    }
    if let Some(name) = body.strip_suffix("FOUND") {
        return Ok(Verdict::Infected(name.trim().chars().take(120).collect()));
    }
    Err(format!("réponse clamd inattendue : {}", r.chars().take(120).collect::<String>()))
}

/// Protocole INSTREAM : blocs (longueur 32 bits gros-boutiste + données), bloc vide final.
pub async fn instream<S: AsyncRead + AsyncWrite + Unpin>(stream: &mut S, data: &[u8]) -> std::io::Result<String> {
    stream.write_all(b"zINSTREAM\0").await?;
    for chunk in data.chunks(CHUNK) {
        stream.write_all(&(chunk.len() as u32).to_be_bytes()).await?;
        stream.write_all(chunk).await?;
    }
    stream.write_all(&0u32.to_be_bytes()).await?;
    stream.flush().await?;
    let mut reply = Vec::new();
    stream.take(4096).read_to_end(&mut reply).await?;
    Ok(String::from_utf8_lossy(&reply).into_owned())
}

async fn ask(addr: &str, data: &[u8]) -> std::result::Result<Verdict, String> {
    let reply = if let Some(path) = addr.strip_prefix("unix:") {
        #[cfg(unix)]
        {
            let mut s = tokio::net::UnixStream::connect(path).await.map_err(|e| e.to_string())?;
            instream(&mut s, data).await.map_err(|e| e.to_string())?
        }
        #[cfg(not(unix))]
        {
            let _ = path;
            return Err("socket unix indisponible".into());
        }
    } else {
        let hostport = addr.strip_prefix("tcp:").unwrap_or(addr);
        let mut s = tokio::net::TcpStream::connect(hostport).await.map_err(|e| e.to_string())?;
        instream(&mut s, data).await.map_err(|e| e.to_string())?
    };
    parse_reply(&reply)
}

/// Refuse le fichier s'il est infecté (sans effet si l'antivirus n'est pas configuré).
pub async fn check(data: &[u8]) -> Result<()> {
    let Some(addr) = std::env::var("CLAMAV_ADDR").ok().filter(|a| !a.trim().is_empty()) else { return Ok(()) };
    let required = std::env::var("CLAMAV_REQUIRED").is_ok_and(|v| v == "true" || v == "1");
    let why = match tokio::time::timeout(TIMEOUT, ask(addr.trim(), data)).await {
        Ok(Ok(Verdict::Clean)) => return Ok(()),
        Ok(Ok(Verdict::Infected(name))) => {
            tracing::warn!("fichier refusé par l'antivirus : {name}");
            return Err(AppError::BadRequest("Fichier refusé : l'antivirus y a détecté un logiciel malveillant.".into()));
        }
        Ok(Err(e)) => e,
        Err(_) => "délai dépassé".into(),
    };
    if required {
        tracing::warn!("antivirus injoignable ({why}) : envoi refusé (CLAMAV_REQUIRED)");
        return Err(AppError::Unavailable("Analyse antivirus indisponible, réessaie plus tard.".into()));
    }
    tracing::warn!("antivirus injoignable ({why}) : fichier accepté sans analyse");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replies() {
        assert_eq!(parse_reply("stream: OK\0"), Ok(Verdict::Clean));
        assert_eq!(parse_reply("stream: Win.Test.EICAR_HDB-1 FOUND\0"), Ok(Verdict::Infected("Win.Test.EICAR_HDB-1".into())));
        assert!(parse_reply("INSTREAM size limit exceeded. ERROR\0").is_err());
    }

    /// Faux clamd : vérifie le découpage INSTREAM et répond selon le contenu.
    #[tokio::test]
    async fn instream_against_fake_clamd() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let (mut s, _) = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let mut cmd = [0u8; 10];
                    s.read_exact(&mut cmd).await.unwrap();
                    assert_eq!(&cmd, b"zINSTREAM\0");
                    let mut all = Vec::new();
                    loop {
                        let mut len = [0u8; 4];
                        s.read_exact(&mut len).await.unwrap();
                        let n = u32::from_be_bytes(len) as usize;
                        if n == 0 { break }
                        assert!(n <= CHUNK);
                        let mut buf = vec![0u8; n];
                        s.read_exact(&mut buf).await.unwrap();
                        all.extend(buf);
                    }
                    let eicar = all.windows(5).any(|w| w == b"EICAR");
                    let reply: &[u8] = if eicar { b"stream: Eicar-Test-Signature FOUND\0" } else { b"stream: OK\0" };
                    s.write_all(reply).await.unwrap();
                });
            }
        });
        let a = format!("tcp:{addr}");
        let big = vec![7u8; 200_000];
        assert_eq!(ask(&a, &big).await, Ok(Verdict::Clean));
        assert_eq!(ask(&a, b"X5O!P%@AP EICAR test").await, Ok(Verdict::Infected("Eicar-Test-Signature".into())));
        assert!(ask("tcp:127.0.0.1:1", b"x").await.is_err());
    }
}
