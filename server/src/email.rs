use lettre::{
    message::header::ContentType,
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};

use crate::config::Config;

/// Envoi générique d'un email HTML. Retourne `Ok(true)` si envoyé, `Ok(false)` si SMTP non configuré.
pub async fn send_email(config: &Config, to: &str, subject: &str, html_body: String) -> anyhow::Result<bool> {
    if let Some(dir) = &config.test_mailbox {
        return write_test_mail(dir, to, subject, &html_body).await.map(|_| true);
    }
    let (Some(host), Some(user), Some(pass)) = (
        &config.smtp_host,
        &config.smtp_user,
        &config.smtp_pass,
    ) else {
        tracing::warn!("SMTP non configuré — e-mail non envoyé");
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
            .timeout(Some(std::time::Duration::from_secs(30)))
            .build();

    mailer.send(email).await?;
    Ok(true)
}

/// Tests de bout en bout (FORGECHAT_TEST_MAILBOX, voir config.rs) : un fichier JSON par e-mail.
async fn write_test_mail(dir: &str, to: &str, subject: &str, html_body: &str) -> anyhow::Result<()> {
    let path = std::path::Path::new(dir).join(format!("{}-{}", chrono::Utc::now().timestamp_millis(), uuid::Uuid::new_v4()));
    let mail = serde_json::json!({ "to": to, "subject": subject, "body": html_body });
    tokio::fs::create_dir_all(dir).await?;
    // Écrit puis renommé : le lecteur ne voit jamais un fichier à moitié écrit.
    tokio::fs::write(path.with_extension("tmp"), mail.to_string()).await?;
    tokio::fs::rename(path.with_extension("tmp"), path.with_extension("json")).await?;
    Ok(())
}
