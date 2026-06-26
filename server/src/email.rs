use lettre::{
    message::header::ContentType,
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};

use crate::config::Config;

/// Envoi générique d'un email HTML. Retourne `Ok(true)` si envoyé, `Ok(false)` si SMTP non configuré.
pub async fn send_email(config: &Config, to: &str, subject: &str, html_body: String) -> anyhow::Result<bool> {
    let (Some(host), Some(user), Some(pass)) = (
        &config.smtp_host,
        &config.smtp_user,
        &config.smtp_pass,
    ) else {
        tracing::warn!("SMTP non configuré — email non envoyé à {}", to);
        return Ok(false);
    };

    let email = Message::builder()
        .from(config.smtp_from.parse()?)
        .to(to.parse()?)
        .subject(subject)
        .header(ContentType::TEXT_HTML)
        .body(html_body)?;

    let creds = Credentials::new(user.clone(), pass.clone());

    let mailer: AsyncSmtpTransport<Tokio1Executor> =
        AsyncSmtpTransport::<Tokio1Executor>::relay(host)?
            .port(config.smtp_port)
            .credentials(creds)
            .build();

    mailer.send(email).await?;
    Ok(true)
}

/// Retourne `Ok(true)` si l'email a été envoyé, `Ok(false)` si SMTP non configuré.
pub async fn send_verification_email(config: &Config, to: &str, code: &str) -> anyhow::Result<bool> {
    let (Some(host), Some(user), Some(pass)) = (
        &config.smtp_host,
        &config.smtp_user,
        &config.smtp_pass,
    ) else {
        tracing::warn!("SMTP non configuré — inscription en attente pour {}", to);
        return Ok(false);
    };

    let body = format!(
        r#"<!DOCTYPE html><html><body style="font-family:sans-serif;background:#1e1f22;color:#dbdee1;padding:32px">
<div style="max-width:480px;margin:auto;background:#313338;border-radius:12px;padding:32px">
  <h2 style="color:#5865f2;margin-top:0">Vérification ForgeChat</h2>
  <p>Voici ton code de vérification :</p>
  <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#fff;background:#1e1f22;
              border-radius:8px;padding:16px;text-align:center;margin:24px 0">{}</div>
  <p style="color:#949ba4;font-size:13px">Ce code expire dans 15 minutes.</p>
</div></body></html>"#,
        code
    );

    let email = Message::builder()
        .from(config.smtp_from.parse()?)
        .to(to.parse()?)
        .subject("Code de vérification ForgeChat")
        .header(ContentType::TEXT_HTML)
        .body(body)?;

    let creds = Credentials::new(user.clone(), pass.clone());

    let mailer: AsyncSmtpTransport<Tokio1Executor> =
        AsyncSmtpTransport::<Tokio1Executor>::relay(host)?
            .port(config.smtp_port)
            .credentials(creds)
            .build();

    mailer.send(email).await?;
    Ok(true)
}
