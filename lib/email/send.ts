import { Resend } from "resend";

export type EmailResult =
  | { sent: true }
  | { sent: false; reason: string };

/**
 * Email is optional: without RESEND_API_KEY the app still issues invites, and
 * the Members page falls back to showing a link you send yourself. Nothing here
 * ever throws — a failed send must not lose an invite that was already created.
 */
function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
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
  const resend = client();
  if (!resend) {
    return { sent: false, reason: "Email isn't configured (RESEND_API_KEY is not set)." };
  }

  const from = process.env.EMAIL_FROM;
  if (!from) {
    return { sent: false, reason: "Email isn't configured (EMAIL_FROM is not set)." };
  }

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

  try {
    const { error } = await resend.emails.send({
      from,
      to,
      subject: `You've been invited to ${workspaceName}`,
      html,
      text,
    });
    if (error) {
      return { sent: false, reason: error.message };
    }
    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      reason: err instanceof Error ? err.message : "Unknown error sending the email.",
    };
  }
}
