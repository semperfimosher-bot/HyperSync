from __future__ import annotations

import asyncio
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr
from html import escape
from urllib.parse import urlencode

from ..config import get_settings


class EmailDeliveryError(RuntimeError):
    """Raised when an account email cannot be delivered."""


def _deliver_message(
    message: EmailMessage,
) -> None:
    settings = get_settings()

    host = settings.smtp_host.strip()
    sender = settings.smtp_from_email.strip()

    if not host or not sender:
        raise EmailDeliveryError(
            "SMTP delivery is not configured."
        )

    context = ssl.create_default_context()

    try:
        if settings.smtp_use_ssl:
            with smtplib.SMTP_SSL(
                host=host,
                port=settings.smtp_port,
                timeout=15,
                context=context,
            ) as smtp:
                if settings.smtp_username:
                    smtp.login(
                        settings.smtp_username,
                        settings.smtp_password,
                    )
                smtp.send_message(message)
            return

        with smtplib.SMTP(
            host=host,
            port=settings.smtp_port,
            timeout=15,
        ) as smtp:
            smtp.ehlo()

            if settings.smtp_starttls:
                smtp.starttls(context=context)
                smtp.ehlo()

            if settings.smtp_username:
                smtp.login(
                    settings.smtp_username,
                    settings.smtp_password,
                )

            smtp.send_message(message)
    except (
        OSError,
        smtplib.SMTPException,
    ) as exc:
        raise EmailDeliveryError(
            "SMTP delivery failed."
        ) from exc


async def send_password_recovery_email(
    *,
    recipient_email: str,
    username: str,
    otp_code: str,
    reset_token: str,
    expires_minutes: int,
) -> None:
    settings = get_settings()

    frontend_url = (
        settings.frontend_public_url
        .strip()
        .rstrip("/")
    )

    if not frontend_url:
        raise EmailDeliveryError(
            "Frontend public URL is not configured."
        )

    reset_url = (
        frontend_url
        + "/reset-password?"
        + urlencode(
            {
                "token": reset_token,
            }
        )
    )

    message = EmailMessage()
    message["Subject"] = (
        "Your HyperSync account recovery code"
    )
    message["From"] = formataddr(
        (
            settings.smtp_from_name.strip()
            or settings.app_name,
            settings.smtp_from_email.strip(),
        )
    )
    message["To"] = recipient_email

    message.set_content(
        "\n".join(
            [
                f"Hi {username},",
                "",
                (
                    "Your HyperSync recovery code is "
                    f"{otp_code}."
                ),
                (
                    "It expires in "
                    f"{expires_minutes} minutes."
                ),
                "",
                (
                    "You can enter the code in HyperSync "
                    "to sign back in, or reset your password "
                    "with this one-use link:"
                ),
                reset_url,
                "",
                (
                    "If you did not request account recovery, "
                    "you can ignore this email."
                ),
            ]
        )
    )

    safe_username = escape(username)
    safe_reset_url = escape(
        reset_url,
        quote=True,
    )

    message.add_alternative(
        f"""\
<!doctype html>
<html>
  <body style="font-family:Arial,sans-serif;background:#071018;color:#eaf7ff;padding:24px">
    <div style="max-width:560px;margin:auto;background:#0b1720;border:1px solid #1ea7e1;border-radius:14px;padding:24px">
      <h2 style="margin-top:0">HyperSync account recovery</h2>
      <p>Hi {safe_username},</p>
      <p>Your 6-digit recovery code is:</p>
      <p style="font-size:30px;letter-spacing:8px;font-weight:700">{otp_code}</p>
      <p>This code expires in {expires_minutes} minutes.</p>
      <p>You can enter the code in HyperSync to sign back in, or use the button below to choose a new password.</p>
      <p>
        <a href="{safe_reset_url}" style="display:inline-block;padding:12px 18px;background:#0aa9ef;color:white;text-decoration:none;border-radius:10px">
          Reset password
        </a>
      </p>
      <p style="color:#9ab0bc;font-size:13px">If you did not request account recovery, you can ignore this email.</p>
    </div>
  </body>
</html>
""",
        subtype="html",
    )

    await asyncio.to_thread(
        _deliver_message,
        message,
    )
