import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { re } from "../config/runtime-env.js";
import { logger } from "./logger.js";

/**
 * @param {{ to: string; subject: string; text: string; html?: string }} opts
 * @returns {Promise<{ sent: boolean }>}
 */
export async function sendMail(opts) {
  if (!re.smtpHost?.trim()) {
    logger.warn("mail_skipped_no_smtp", {
      to: opts.to,
      subject: opts.subject,
    });
    return { sent: false };
  }

  const transporter = nodemailer.createTransport({
    host: re.smtpHost.trim(),
    port: re.smtpPort,
    secure: re.smtpSecure,
    auth:
      re.smtpUser && re.smtpPass
        ? { user: re.smtpUser, pass: re.smtpPass }
        : undefined,
  });

  await transporter.sendMail({
    from: re.smtpFrom,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html ?? opts.text.replace(/\n/g, "<br/>"),
  });
  return { sent: true };
}

/**
 * @param {{ to: string; resetUrl: string }} p
 */
export async function sendPasswordResetEmail(p) {
  const subject = "Reset your Paython portal password";
  const text = `You asked to reset your portal password.

Open this link (valid for a limited time):
${p.resetUrl}

If you did not request this, you can ignore this email.`;
  const result = await sendMail({ to: p.to, subject, text });
  if (!result.sent && env.nodeEnv !== "production") {
    logger.info("password_reset_dev_link", { to: p.to, resetUrl: p.resetUrl });
  }
  return result;
}
