//! Vérification stricte des images de profil (avatar, bannière, profil par serveur) :
//! le vrai format est lu dans les octets (jamais le Content-Type ni le nom du fichier
//! envoyés par le client), puis dimensions et nombre d'images sont bornés. Un fichier
//! tronqué ou mal formé est refusé. Pour une image animée (GIF, APNG, WebP animé), on
//! fabrique aussi une version fixe (première image) servie quand l'animation est coupée,
//! sans décoder l'image : on recopie seulement les blocs de la première image.

pub const MAX_DIM: u32 = 4096;
pub const MAX_FRAMES: u32 = 2000;

#[derive(Debug, Clone, PartialEq)]
pub struct Probe {
    pub ext: &'static str,
    pub width: u32,
    pub height: u32,
    pub frames: u32,
}

type R<T> = std::result::Result<T, &'static str>;

const BAD: &str = "Image illisible ou corrompue";

fn be32(b: &[u8], at: usize) -> R<u32> {
    b.get(at..at + 4).map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]])).ok_or(BAD)
}
fn le16(b: &[u8], at: usize) -> R<u32> {
    b.get(at..at + 2).map(|s| u16::from_le_bytes([s[0], s[1]]) as u32).ok_or(BAD)
}
fn le24(b: &[u8], at: usize) -> R<u32> {
    b.get(at..at + 3).map(|s| s[0] as u32 | (s[1] as u32) << 8 | (s[2] as u32) << 16).ok_or(BAD)
}
fn le32(b: &[u8], at: usize) -> R<u32> {
    b.get(at..at + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]])).ok_or(BAD)
}

/// Lit le format réel et vérifie les bornes. Rend aussi, pour une image animée, la
/// version fixe (première image) dans le même format.
pub fn probe(data: &[u8]) -> R<(Probe, Option<Vec<u8>>)> {
    let (p, still) = if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        png(data)?
    } else if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        gif(data)?
    } else if data.len() >= 12 && &data[..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        webp(data)?
    } else if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        (jpeg(data)?, None)
    } else {
        return Err("Format non supporté (PNG, GIF, WebP ou JPEG)");
    };
    if p.width == 0 || p.height == 0 || p.width > MAX_DIM || p.height > MAX_DIM {
        return Err("Dimensions refusées (4096 × 4096 px max)");
    }
    if p.frames > MAX_FRAMES {
        return Err("Animation trop longue (2000 images max)");
    }
    Ok((p, still))
}

fn png(d: &[u8]) -> R<(Probe, Option<Vec<u8>>)> {
    let mut at = 8;
    let (mut w, mut h, mut frames) = (0, 0, 1);
    let mut still = d[..8].to_vec();
    let mut animated = false;
    loop {
        let len = be32(d, at)? as usize;
        let ty = d.get(at + 4..at + 8).ok_or(BAD)?;
        let end = at.checked_add(12 + len).filter(|&e| e <= d.len()).ok_or(BAD)?;
        match ty {
            b"IHDR" => { w = be32(d, at + 8)?; h = be32(d, at + 12)?; }
            b"acTL" => { frames = be32(d, at + 8)?; animated = true; }
            _ => {}
        }
        if !matches!(ty, b"acTL" | b"fcTL" | b"fdAT") {
            still.extend_from_slice(&d[at..end]);
        }
        if ty == b"IEND" { break; }
        at = end;
        if frames > MAX_FRAMES { break; }
    }
    let frames = frames.max(1);
    Ok((Probe { ext: "png", width: w, height: h, frames }, (animated && frames > 1).then_some(still)))
}

/// Saute une suite de sous-blocs GIF (taille, octets…, 0) ; rend la position après le 0.
fn gif_sub_blocks(d: &[u8], mut at: usize) -> R<usize> {
    loop {
        let n = *d.get(at).ok_or(BAD)? as usize;
        at += 1;
        if n == 0 { return Ok(at); }
        at += n;
        if at > d.len() { return Err(BAD); }
    }
}

fn gif(d: &[u8]) -> R<(Probe, Option<Vec<u8>>)> {
    let (w, h) = (le16(d, 6)?, le16(d, 8)?);
    let packed = *d.get(10).ok_or(BAD)?;
    let mut at = 13 + if packed & 0x80 != 0 { 3 << ((packed & 7) + 1) } else { 0 };
    let mut frames = 0u32;
    let mut first_end = 0;
    loop {
        match *d.get(at).ok_or(BAD)? {
            0x2C => {
                let p = *d.get(at + 9).ok_or(BAD)?;
                at += 10 + if p & 0x80 != 0 { 3 << ((p & 7) + 1) } else { 0 };
                at = gif_sub_blocks(d, at + 1)?; // +1 : taille de code LZW
                frames += 1;
                if frames == 1 { first_end = at; }
                if frames > MAX_FRAMES { break; }
            }
            0x21 => at = gif_sub_blocks(d, at + 2)?,
            0x3B => break,
            _ => return Err(BAD),
        }
    }
    if frames == 0 { return Err(BAD); }
    let still = (frames > 1).then(|| {
        let mut s = d[..first_end].to_vec();
        s.push(0x3B);
        s
    });
    Ok((Probe { ext: "gif", width: w, height: h, frames }, still))
}

/// Dimensions d'un flux VP8 (avec perte) ou VP8L (sans perte).
fn vp8_dims(ty: &[u8], data: &[u8]) -> R<(u32, u32)> {
    match ty {
        b"VP8 " => {
            if data.get(3..6) != Some(&[0x9d, 0x01, 0x2a][..]) { return Err(BAD); }
            Ok((le16(data, 6)? & 0x3fff, le16(data, 8)? & 0x3fff))
        }
        b"VP8L" => {
            if data.first() != Some(&0x2f) { return Err(BAD); }
            let bits = le32(data, 1)?;
            Ok(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
        }
        _ => Err(BAD),
    }
}

/// Morceau RIFF : (type, données, début, fin alignée).
type RiffChunk<'a> = (&'a [u8], &'a [u8], usize, usize);

fn riff_chunks(d: &[u8], from: usize) -> R<Vec<RiffChunk<'_>>> {
    let mut out = Vec::new();
    let mut at = from;
    while at + 8 <= d.len() {
        let len = le32(d, at + 4)? as usize;
        let end = at.checked_add(8 + len).filter(|&e| e <= d.len()).ok_or(BAD)?;
        out.push((&d[at..at + 4], &d[at + 8..end], at, end + (len & 1)));
        at = end + (len & 1);
    }
    Ok(out)
}

fn webp(d: &[u8]) -> R<(Probe, Option<Vec<u8>>)> {
    let riff_end = (le32(d, 4)? as usize).checked_add(8).filter(|&e| e <= d.len()).ok_or(BAD)?;
    let d = &d[..riff_end];
    let chunks = riff_chunks(d, 12)?;
    let (ty, data, _, _) = *chunks.first().ok_or(BAD)?;
    if ty != b"VP8X" {
        let (w, h) = vp8_dims(ty, data)?;
        return Ok((Probe { ext: "webp", width: w, height: h, frames: 1 }, None));
    }
    let (w, h) = (le24(data, 4)? + 1, le24(data, 7)? + 1);
    let anmf: Vec<_> = chunks.iter().filter(|c| c.0 == b"ANMF").collect();
    let frames = (anmf.len() as u32).max(1);
    let still = match anmf.first() {
        Some(f) if frames > 1 => {
            // Première image : en-tête de 16 octets puis ALPH éventuel + VP8/VP8L.
            let body = f.1.get(16..).ok_or(BAD)?;
            let (fw, fh) = (le24(f.1, 6)? + 1, le24(f.1, 9)? + 1);
            let mut vp8x = vec![0x10, 0, 0, 0]; // drapeau alpha : sans effet si l'image est opaque
            vp8x.extend_from_slice(&(fw - 1).to_le_bytes()[..3]);
            vp8x.extend_from_slice(&(fh - 1).to_le_bytes()[..3]);
            let mut payload = b"WEBPVP8X".to_vec();
            payload.extend_from_slice(&10u32.to_le_bytes());
            payload.extend_from_slice(&vp8x);
            payload.extend_from_slice(body);
            let mut s = b"RIFF".to_vec();
            s.extend_from_slice(&(payload.len() as u32).to_le_bytes());
            s.extend_from_slice(&payload);
            Some(s)
        }
        _ => None,
    };
    Ok((Probe { ext: "webp", width: w, height: h, frames }, still))
}

fn jpeg(d: &[u8]) -> R<Probe> {
    let mut at = 2;
    loop {
        if *d.get(at).ok_or(BAD)? != 0xFF { return Err(BAD); }
        let m = *d.get(at + 1).ok_or(BAD)?;
        if m == 0xFF { at += 1; continue; }
        if (0xD0..=0xD9).contains(&m) || m == 0x01 { at += 2; continue; }
        let len = d.get(at + 2..at + 4).map(|s| u16::from_be_bytes([s[0], s[1]]) as usize).ok_or(BAD)?;
        if len < 2 { return Err(BAD); }
        if matches!(m, 0xC0..=0xCF) && !matches!(m, 0xC4 | 0xC8 | 0xCC) {
            let s = d.get(at + 5..at + 9).ok_or(BAD)?;
            let h = u16::from_be_bytes([s[0], s[1]]) as u32;
            let w = u16::from_be_bytes([s[2], s[3]]) as u32;
            return Ok(Probe { ext: "jpg", width: w, height: h, frames: 1 });
        }
        at += 2 + len;
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// GIF 2×1 minimal, `n` images (chaque image : descripteur + LZW min + 1 sous-bloc).
    pub fn gif_bytes(n: usize) -> Vec<u8> {
        let mut g = b"GIF89a".to_vec();
        g.extend_from_slice(&[2, 0, 1, 0, 0x80, 0, 0]); // 2×1, palette globale de 2 couleurs
        g.extend_from_slice(&[0, 0, 0, 255, 255, 255]);
        g.extend_from_slice(&[0x21, 0xFF, 11]); // extension NETSCAPE (boucle)
        g.extend_from_slice(b"NETSCAPE2.0");
        g.extend_from_slice(&[3, 1, 0, 0, 0]);
        for _ in 0..n {
            g.extend_from_slice(&[0x21, 0xF9, 4, 0, 10, 0, 0, 0]); // contrôle graphique
            g.extend_from_slice(&[0x2C, 0, 0, 0, 0, 2, 0, 1, 0, 0]);
            g.extend_from_slice(&[2, 2, 0x44, 0x01, 0]);
        }
        g.push(0x3B);
        g
    }

    fn chunk(ty: &[u8], data: &[u8]) -> Vec<u8> {
        let mut c = (data.len() as u32).to_be_bytes().to_vec();
        c.extend_from_slice(ty);
        c.extend_from_slice(data);
        c.extend_from_slice(&[0; 4]); // CRC non vérifié
        c
    }

    fn png_bytes(w: u32, h: u32, frames: Option<u32>) -> Vec<u8> {
        let mut p = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut ihdr = w.to_be_bytes().to_vec();
        ihdr.extend_from_slice(&h.to_be_bytes());
        ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
        p.extend(chunk(b"IHDR", &ihdr));
        if let Some(n) = frames {
            let mut a = n.to_be_bytes().to_vec();
            a.extend_from_slice(&[0; 4]);
            p.extend(chunk(b"acTL", &a));
            p.extend(chunk(b"fcTL", &[0; 26]));
        }
        p.extend(chunk(b"IDAT", &[1, 2, 3]));
        if frames.is_some() {
            p.extend(chunk(b"fcTL", &[0; 26]));
            p.extend(chunk(b"fdAT", &[0; 8]));
        }
        p.extend(chunk(b"IEND", &[]));
        p
    }

    fn riff(ty: &[u8], data: &[u8]) -> Vec<u8> {
        let mut c = ty.to_vec();
        c.extend_from_slice(&(data.len() as u32).to_le_bytes());
        c.extend_from_slice(data);
        if data.len() % 2 == 1 { c.push(0); }
        c
    }

    fn webp_file(chunks: &[Vec<u8>]) -> Vec<u8> {
        let body: Vec<u8> = chunks.concat();
        let mut f = b"RIFF".to_vec();
        f.extend_from_slice(&((body.len() + 4) as u32).to_le_bytes());
        f.extend_from_slice(b"WEBP");
        f.extend(body);
        f
    }

    fn vp8l(w: u32, h: u32) -> Vec<u8> {
        let bits = (w - 1) | (h - 1) << 14;
        let mut d = vec![0x2f];
        d.extend_from_slice(&bits.to_le_bytes());
        riff(b"VP8L", &d)
    }

    #[test]
    fn gif_fixe_et_anime() {
        let (p, still) = probe(&gif_bytes(1)).unwrap();
        assert_eq!(p, Probe { ext: "gif", width: 2, height: 1, frames: 1 });
        assert!(still.is_none());

        let (p, still) = probe(&gif_bytes(3)).unwrap();
        assert_eq!(p.frames, 3);
        // La version fixe est elle-même un GIF valide d'une seule image.
        let (s, none) = probe(&still.unwrap()).unwrap();
        assert_eq!((s.frames, s.width, none), (1, 2, None));
    }

    #[test]
    fn gif_tronque_ou_trop_long() {
        let g = gif_bytes(2);
        assert!(probe(&g[..g.len() - 4]).is_err());
        assert!(probe(&gif_bytes(MAX_FRAMES as usize + 1)).is_err());
    }

    #[test]
    fn png_et_apng() {
        let (p, still) = probe(&png_bytes(64, 32, None)).unwrap();
        assert_eq!((p.ext, p.width, p.height, p.frames), ("png", 64, 32, 1));
        assert!(still.is_none());

        let (p, still) = probe(&png_bytes(64, 32, Some(5))).unwrap();
        assert_eq!(p.frames, 5);
        let (s, _) = probe(&still.unwrap()).unwrap();
        assert_eq!(s.frames, 1);

        assert!(probe(&png_bytes(5000, 10, None)).is_err());
        assert!(probe(&png_bytes(0, 10, None)).is_err());
    }

    #[test]
    fn webp_simple_et_anime() {
        let (p, _) = probe(&webp_file(&[vp8l(300, 200)])).unwrap();
        assert_eq!((p.ext, p.width, p.height, p.frames), ("webp", 300, 200, 1));

        let mut vp8x = vec![0x02, 0, 0, 0];
        vp8x.extend_from_slice(&99u32.to_le_bytes()[..3]);
        vp8x.extend_from_slice(&49u32.to_le_bytes()[..3]);
        let mut frame = vec![0; 6];
        frame.extend_from_slice(&99u32.to_le_bytes()[..3]);
        frame.extend_from_slice(&49u32.to_le_bytes()[..3]);
        frame.extend_from_slice(&[0; 4]);
        frame.extend(vp8l(100, 50));
        let f = webp_file(&[riff(b"VP8X", &vp8x), riff(b"ANIM", &[0; 6]), riff(b"ANMF", &frame), riff(b"ANMF", &frame)]);
        let (p, still) = probe(&f).unwrap();
        assert_eq!((p.width, p.height, p.frames), (100, 50, 2));
        let (s, _) = probe(&still.unwrap()).unwrap();
        assert_eq!((s.width, s.height, s.frames), (100, 50, 1));
    }

    #[test]
    fn jpeg_dimensions() {
        let mut j = vec![0xFF, 0xD8, 0xFF, 0xE0, 0, 4, 0, 0];
        j.extend_from_slice(&[0xFF, 0xC0, 0, 11, 8, 0, 120, 0, 160, 3, 0, 0, 0]);
        let (p, _) = probe(&j).unwrap();
        assert_eq!((p.ext, p.width, p.height), ("jpg", 160, 120));
    }

    #[test]
    fn faux_types_refuses() {
        assert!(probe(b"<svg xmlns='http://www.w3.org/2000/svg'/>").is_err());
        assert!(probe(b"<html><script>alert(1)</script>").is_err());
        assert!(probe(b"GIF89a").is_err());
        assert!(probe(b"").is_err());
        assert!(probe(&[0xFF, 0xD8, 0xFF]).is_err());
    }
}
