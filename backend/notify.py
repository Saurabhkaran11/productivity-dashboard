import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders


def send_smtp(settings: dict, to: str, subject: str, body_html: str, attachment: tuple = None):
    host = settings.get("smtp_host")
    port = settings.get("smtp_port")
    user = settings.get("smtp_user")
    password = settings.get("smtp_password")
    if not (host and port and user and password):
        raise ValueError("SMTP is not configured.")

    msg = MIMEMultipart("mixed")
    msg["To"] = to
    msg["From"] = user
    msg["Subject"] = subject
    msg.attach(MIMEText(body_html, "html", "utf-8"))

    if attachment:
        filename, content, mime = attachment
        part = MIMEBase("application", "octet-stream")
        part.set_payload(content)
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", f"attachment; filename={filename}")
        msg.attach(part)

    with smtplib.SMTP(host, port, timeout=30) as server:
        server.starttls()
        server.login(user, password)
        server.sendmail(user, [to], msg.as_string())


def send_smtp_test(settings: dict, to: str):
    body = (
        "<h2>Test email</h2>"
        "<p>This is a test email from your <b>MyLife Productivity Dashboard</b>. "
        "If you received this, your SMTP settings are working correctly.</p>"
    )
    send_smtp(settings, to, "MyLife Dashboard - Test Email", body)
