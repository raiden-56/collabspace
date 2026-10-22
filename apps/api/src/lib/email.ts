import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";
import { logger } from "./logger.js";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  if (config.EMAIL_DRIVER !== "smtp" || !config.SMTP_HOST) {
    transporter = null;
    return transporter;
  }
  transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT ?? 587,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS ?? "" } : undefined,
  });
  return transporter;
}

export interface SendResult {
  delivered: boolean;
  driver: string;
  messageId?: string;
  error?: string;
}

/** Sends email through SMTP when configured; otherwise logs. Never throws. */
export async function sendMail(mail: Mail): Promise<SendResult> {
  if (config.EMAIL_DRIVER === "disabled") return { delivered: false, driver: "disabled" };
  const t = getTransporter();
  if (!t) {
    logger.info({ to: mail.to, subject: mail.subject }, "[email:log] " + mail.text.slice(0, 300));
    return { delivered: false, driver: "log" };
  }
  try {
    const info = await t.sendMail({ from: config.EMAIL_FROM, ...mail });
    return { delivered: true, driver: "smtp", messageId: info.messageId };
  } catch (err) {
    logger.error({ err, to: mail.to }, "Email delivery failed");
    return { delivered: false, driver: "smtp", error: (err as Error).message };
  }
}

export function emailLayout(title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  return `<!doctype html><html><body style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#F7F8FC;padding:32px;color:#1F2430">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #E3E7F0">
    <div style="font-weight:700;font-size:18px;color:#5B8CFF;margin-bottom:16px">CollabSpace</div>
    <h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>
    <div style="font-size:15px;line-height:1.6">${bodyHtml}</div>
    ${cta ? `<p style="margin-top:24px"><a href="${cta.url}" style="background:#5B8CFF;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">${escapeHtml(cta.label)}</a></p>` : ""}
    <p style="font-size:12px;color:#A0A9BC;margin-top:32px">You received this email because you have a CollabSpace account or were invited to a workspace.</p>
  </div></body></html>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
