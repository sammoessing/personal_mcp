import { Resend } from "resend";
import nodemailer from "nodemailer";

export type EmailResult =
  | { sent: true; via: "gmail" | "resend" }
  | { sent: false; reason: string };

/**
 * Two ways to send, in this order:
 *
 * 1. Gmail over SMTP, using an app password. Invites then genuinely come from
 *    a personal address, which is what people expect from a small team and
 *    what avoids Resend's requirement to own and verify a sending domain.
 * 2. Resend, for a proper domain once there is one.
 *
 * Both are optional. Without either, invites are still created and the Members
 * page shows a link to pass along by hand. Nothing here ever throws — a failed
 * send must not lose an invite that was already issued.
 */
type Message = { to: string; subject: string; html: string; text: string };

/**
 * Gmail requires the envelope sender to be the authenticated account, so the
 * From header is taken from GMAIL_USER rather than EMAIL_FROM. Setting it to
 * anything else makes Gmail either rewrite it or reject the message.
 */
async function sendViaGmail(message: Message): Promise<EmailResult | null> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;

  try {
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
    });

    await transport.sendMail({
      from: `${process.env.EMAIL_FROM_NAME ?? "Charted"} <${user}>`,
      // Replies go to a human rather than into an unwatched mailbox.
      replyTo: user,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    return { sent: true, via: "gmail" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown SMTP error.";
    return {
      sent: false,
      // The overwhelmingly common cause is a normal account password used
      // where an app password is required, so name it.
      reason: /invalid login|username and password not accepted|badcredentials/i.test(reason)
        ? "Gmail rejected the login. GMAIL_APP_PASSWORD must be a 16-character app password (Google Account → Security → App passwords), not your normal password, and 2-Step Verification must be on."
        : reason,
    };
  }
}

async function sendViaResend(message: Message): Promise<EmailResult | null> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return null;

  try {
    const { error } = await new Resend(key).emails.send({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (error) return { sent: false, reason: error.message };
    return { sent: true, via: "resend" };
  } catch (err) {
    return {
      sent: false,
      reason: err instanceof Error ? err.message : "Unknown error sending the email.",
    };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendInviteEmail({
  to,
  inviteUrl,
  workspaceName,
  workspaceLogoUrl,
  invitedByEmail,
}: {
  to: string;
  inviteUrl: string;
  workspaceName: string;
  workspaceLogoUrl?: string | null;
  invitedByEmail?: string | null;
}): Promise<EmailResult> {
  const safeWorkspace = escapeHtml(workspaceName);
  const inviter = invitedByEmail ? escapeHtml(invitedByEmail) : null;

  // Deliberately plain, inline-styled HTML: email clients strip stylesheets, and
  // the workspace logo is what makes this read as the client's own tool.
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#171717">
  ${
    workspaceLogoUrl
      ? `<img src="${escapeHtml(workspaceLogoUrl)}" alt="" width="48" height="48" style="border-radius:8px;display:block;margin-bottom:20px" />`
      : ""
  }
  <h1 style="font-size:20px;font-weight:600;margin:0 0 12px">You've been invited to ${safeWorkspace}</h1>
  <p style="font-size:14px;line-height:1.6;margin:0 0 20px;color:#525252">
    ${inviter ? `${inviter} has invited you` : "You've been invited"} to join
    <strong style="color:#171717">${safeWorkspace}</strong> — the workspace holding its
    shared knowledge, skills, and connected tools.
  </p>
  <a href="${escapeHtml(inviteUrl)}"
     style="display:inline-block;background:#171717;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:500">
    Accept invitation
  </a>
  <p style="font-size:12px;line-height:1.6;margin:24px 0 0;color:#737373">
    This link is valid for 7 days and only works for ${escapeHtml(to)}.
    If you weren't expecting it, you can ignore this email.
  </p>
  <p style="font-size:12px;line-height:1.6;margin:12px 0 0;color:#a3a3a3;word-break:break-all">
    ${escapeHtml(inviteUrl)}
  </p>
</div>`.trim();

  const text = [
    `You've been invited to ${workspaceName}.`,
    "",
    `${inviter ? `${invitedByEmail} has invited you` : "You've been invited"} to join ${workspaceName}.`,
    "",
    `Accept the invitation: ${inviteUrl}`,
    "",
    `This link is valid for 7 days and only works for ${to}.`,
  ].join("\n");

  const message: Message = {
    to,
    subject: `You've been invited to ${workspaceName}`,
    html,
    text,
  };

  return (
    (await sendViaGmail(message)) ??
    (await sendViaResend(message)) ?? {
      sent: false,
      reason:
        "Email isn't configured. Set GMAIL_USER and GMAIL_APP_PASSWORD to send from your own address, or RESEND_API_KEY and EMAIL_FROM to send from a domain.",
    }
  );
}
