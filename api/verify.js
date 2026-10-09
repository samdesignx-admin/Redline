// Email verification via Resend, using stateless HMAC tokens.
//
// Serverless functions have no shared memory, so instead of storing codes we
// issue a signed token: HMAC(email + code + expiry, VERIFY_SECRET). The client
// holds the token, sends it back with the code the user typed, and the server
// recomputes the signature to validate. Nothing is persisted server-side.
//
// Required environment variables:
//   RESEND_API_KEY  - from resend.com
//   VERIFY_SECRET   - any long random string
//   VERIFY_FROM     - verified sender, e.g. "UXNest <noreply@yourdomain.com>"
//                     (during testing Resend allows onboarding@resend.dev)

import {
  requireDb, hashPassword, cleanEmail as normalizeEmail, isEmail, rateLimit, clientIp,
  issueVerification, checkVerification, verificationConfigured, passwordFingerprint,
  MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH,
} from "./_lib.js";

export const maxDuration = 20;

// Reset codes are bound to the account's current password hash, so a code is
// single-use: once the password changes it no longer verifies. Unknown emails
// get a binding that no code can ever satisfy.
async function resetBinding(db, email) {
  const { data } = await db.from("accounts").select("id, password_hash").eq("email", email).maybeSingle();
  return { account: data || null, binding: data ? passwordFingerprint(data.password_hash) : "no-account" };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!verificationConfigured()) {
    res.status(500).json({ error: "Server misconfigured: VERIFY_SECRET is not set" });
    return;
  }

  const { action, email, code, token, purpose: requestedPurpose, newPassword } = req.body || {};
  const cleanEmail = normalizeEmail(email);
  if (!isEmail(cleanEmail)) {
    res.status(400).json({ error: "A valid email address is required" });
    return;
  }

  const db = requireDb(res);
  if (!db) return;
  const ip = clientIp(req);

  // ---------- Send a code ----------
  if (action === "send") {
    if (!process.env.RESEND_API_KEY) {
      res.status(500).json({ error: "Server misconfigured: RESEND_API_KEY is not set" });
      return;
    }
    if (!(await rateLimit(db, `send:ip:${ip}`, 10, 3600)) || !(await rateLimit(db, `send:email:${cleanEmail}`, 5, 3600))) {
      res.status(429).json({ error: "Too many verification requests. Please try again later." });
      return;
    }

    const purpose = requestedPurpose === "reset" ? "reset" : "signup";
    let binding = "";
    let deliver = true;
    if (purpose === "reset") {
      const found = await resetBinding(db, cleanEmail);
      binding = found.binding;
      // Respond identically for unknown addresses, but don't email them: this
      // avoids both account enumeration and using us to spam arbitrary inboxes.
      deliver = !!found.account;
    }
    const { code: generated, expires, token: issuedToken } = issueVerification(cleanEmail, purpose, binding);

    if (!deliver) {
      res.status(200).json({ token: issuedToken, expires, purpose });
      return;
    }

    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: process.env.VERIFY_FROM || "UXNest <onboarding@resend.dev>",
          to: [cleanEmail],
          subject: `${generated} is your UXNest ${purpose === "reset" ? "password reset" : "verification"} code`,
          text: `Your UXNest ${purpose === "reset" ? "password reset" : "verification"} code is ${generated}.\n\nIt expires in 10 minutes. If you didn't request this, you can ignore this email.`,
          html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    body { margin:0 !important; padding:0 !important; background:#F3F7F5 !important; color:#18211F !important; }
    .email-bg { background:#F3F7F5 !important; }
    .email-card { background:#FFFFFF !important; border:1px solid #DCE7E2 !important; }
    .email-text { color:#18211F !important; }
    .email-muted { color:#5D6D68 !important; }
    .email-code { background:#E7F5EF !important; color:#087A78 !important; border:1px solid #C8E7DB !important; }
    .email-footer { color:#7A8A85 !important; }
    .email-logo-dark { display:none !important; }
    .email-logo-light { display:block !important; }
    @media (prefers-color-scheme: dark) {
      body { background:#0F1715 !important; color:#F3F7F5 !important; }
      .email-bg { background:#0F1715 !important; }
      .email-card { background:#17221F !important; border-color:#2C3B36 !important; }
      .email-text { color:#F3F7F5 !important; }
      .email-muted { color:#B7C5C0 !important; }
      .email-code { background:#203C35 !important; color:#A8E63F !important; border-color:#31594D !important; }
      .email-footer { color:#8FA39C !important; }
      .email-logo-light { display:none !important; }
      .email-logo-dark { display:block !important; }
    }
    @media screen and (max-width:600px) {
      .email-shell { width:100% !important; }
      .email-card { border-radius:0 !important; }
      .email-pad { padding:28px 22px !important; }
    }
    [data-ogsc] .email-bg { background:#0F1715 !important; }
    [data-ogsc] .email-card { background:#17221F !important; border-color:#2C3B36 !important; }
    [data-ogsc] .email-text { color:#F3F7F5 !important; }
    [data-ogsc] .email-muted { color:#B7C5C0 !important; }
    [data-ogsc] .email-code { background:#203C35 !important; color:#A8E63F !important; border-color:#31594D !important; }
    [data-ogsc] .email-footer { color:#8FA39C !important; }
  </style>
</head>
<body class="email-bg" style="margin:0;padding:0;background:#F3F7F5;color:#18211F;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" style="width:100%;background:#F3F7F5;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-shell" style="width:100%;max-width:520px;">
          <tr>
            <td align="center" style="padding:0 0 18px;">
              <img class="email-logo-light" src="https://uxnest.ai/uxnest-icon.png" width="42" height="42" alt="UXNest" style="display:block;width:42px;height:42px;border:0;">
              <img class="email-logo-dark" src="https://uxnest.ai/uxnest-icon.png" width="42" height="42" alt="UXNest" style="display:none;width:42px;height:42px;border:0;">
            </td>
          </tr>
          <tr>
            <td class="email-card email-pad" style="background:#FFFFFF;border:1px solid #DCE7E2;border-radius:18px;padding:36px 34px;">
              <h1 class="email-text" style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:1.25;font-weight:800;color:#18211F;">${purpose === "reset" ? "Reset your password" : "Verify your email"}</h1>
              <p class="email-muted" style="margin:0 0 26px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#5D6D68;">${purpose === "reset" ? "Enter this code in UXNest to choose a new password." : "Enter this code in UXNest to finish creating your account."}</p>
              <div class="email-code" style="background:#E7F5EF;color:#087A78;border:1px solid #C8E7DB;border-radius:14px;padding:18px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:34px;line-height:1;font-weight:800;letter-spacing:7px;">${generated}</div>
              <p class="email-muted" style="margin:22px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#5D6D68;">This code expires in 10 minutes. If you didn't request this email, you can safely ignore it.</p>
            </td>
          </tr>
          <tr>
            <td align="center" class="email-footer" style="padding:18px 12px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#7A8A85;">
              UXNest · AI-powered tools for better digital experiences
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
        }),
      });
      if (!r.ok) {
        const detail = await r.text();
        res.status(502).json({ error: `Couldn't send the verification email. ${detail.slice(0, 200)}` });
        return;
      }
    } catch (e) {
      res.status(502).json({ error: "Couldn't reach the email service. Please try again." });
      return;
    }

    // The code itself is never returned — only the signed envelope.
    res.status(200).json({ token: issuedToken, expires, purpose });
    return;
  }

  // Both remaining actions accept guesses at a 6-digit code, so they share a
  // tight attempt budget per address (and a looser one per IP).
  if (action === "verify" || action === "reset") {
    if (!(await rateLimit(db, `verify:email:${cleanEmail}`, 8, 600)) || !(await rateLimit(db, `verify:ip:${ip}`, 40, 600))) {
      res.status(429).json({ error: "Too many attempts. Request a new code and try again later." });
      return;
    }
  }

  // ---------- Check a code ----------
  if (action === "verify") {
    const purpose = String(token || "").split(".")[0] === "reset" ? "reset" : "signup";
    const binding = purpose === "reset" ? (await resetBinding(db, cleanEmail)).binding : "";
    const result = checkVerification({ email: cleanEmail, purpose, code, token, binding });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(200).json({ verified: true, purpose });
    return;
  }

  // ---------- Reset an existing password ----------
  if (action === "reset") {
    const password = String(newPassword || "");
    if (password.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({ error: "Password must be at least 6 characters." });
      return;
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      res.status(400).json({ error: "Password is too long." });
      return;
    }
    try {
      const { account, binding } = await resetBinding(db, cleanEmail);
      const result = checkVerification({ email: cleanEmail, purpose: "reset", code, token, binding });
      // Same message whether the code is wrong or the account doesn't exist.
      if (!result.ok || !account) {
        res.status(400).json({ error: result.ok ? "That code isn't right. Check the email and try again." : result.error });
        return;
      }
      const { data: current } = await db.from("accounts").select("session_epoch").eq("id", account.id).maybeSingle();
      const update = {
        password_hash: await hashPassword(password),
        last_login_at: new Date().toISOString(),
        // Revoke every session issued before the reset.
        session_epoch: ((current && current.session_epoch) || 0) + 1,
      };
      let { error } = await db.from("accounts").update(update).eq("id", account.id);
      if (error && /session_epoch/i.test(error.message || "")) {
        delete update.session_epoch; // migration not applied yet
        ({ error } = await db.from("accounts").update(update).eq("id", account.id));
      }
      if (error) throw error;
      res.status(200).json({ reset: true });
    } catch (e) {
      console.error("[UXNest reset]", e);
      res.status(500).json({ error: "Password reset failed. Please try again." });
    }
    return;
  }

  res.status(400).json({ error: "Unknown action" });
}
