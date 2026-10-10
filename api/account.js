// Account endpoints: signup, login, session restore, Google sign-in.
// Passwords are hashed server-side with scrypt; the browser never sees a hash.

import {
  requireDb, hashPassword, verifyPassword, issueSession, authenticate,
  cleanEmail, isEmail, publicAccount, rateLimit, clientIp,
  checkVerification, verificationConfigured, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH,
} from "./_lib.js";

export const maxDuration = 20;

const short = (v, n) => String(v || "").trim().slice(0, n);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const db = requireDb(res);
  if (!db) return;

  const { action } = req.body || {};
  const ip = clientIp(req);

  try {
    /* ---------------- Restore a session ---------------- */
    if (action === "session") {
      const sess = await authenticate(db, req.body.token);
      if (!sess) {
        res.status(200).json({ account: null });
        return;
      }
      const { data } = await db.from("accounts").select("*").eq("id", sess.accountId).maybeSingle();
      res.status(200).json({ account: publicAccount(data) });
      return;
    }

    /* ---------------- Sign up ---------------- */
    if (action === "signup") {
      if (!(await rateLimit(db, `signup:ip:${ip}`, 10, 3600))) {
        res.status(429).json({ error: "Too many sign-up attempts. Please try again later." });
        return;
      }
      const email = cleanEmail(req.body.email);
      const { password, name, company, mobile, code, verifyToken } = req.body;
      if (!isEmail(email)) { res.status(400).json({ error: "Enter a valid email address." }); return; }
      if (!password || String(password).length < MIN_PASSWORD_LENGTH) { res.status(400).json({ error: "Password must be at least 6 characters." }); return; }
      if (String(password).length > MAX_PASSWORD_LENGTH) { res.status(400).json({ error: "Password is too long." }); return; }

      // The emailed code must be proven here, on the server. The client's
      // claim that the address is verified is never trusted.
      if (!verificationConfigured()) {
        res.status(500).json({ error: "Server misconfigured: VERIFY_SECRET is not set" });
        return;
      }
      if (!(await rateLimit(db, `verify:email:${email}`, 8, 600))) {
        res.status(429).json({ error: "Too many attempts. Request a new code and try again later." });
        return;
      }
      const verified = checkVerification({ email, purpose: "signup", code, token: verifyToken });
      if (!verified.ok) { res.status(400).json({ error: verified.error }); return; }

      const { data: existing } = await db.from("accounts").select("id").eq("email", email).maybeSingle();
      if (existing) { res.status(409).json({ error: "An account with this email already exists — log in instead." }); return; }

      const { data, error } = await db.from("accounts").insert({
        email,
        name: short(name, 120),
        company: short(company, 120),
        mobile: short(mobile, 40),
        password_hash: await hashPassword(password),
        email_verified: true,
        last_login_at: new Date().toISOString(),
      }).select().single();
      if (error) {
        if (error.code === "23505") { res.status(409).json({ error: "An account with this email already exists — log in instead." }); return; }
        throw error;
      }

      res.status(200).json({ account: publicAccount(data), token: issueSession(data.id, data.session_epoch || 0) });
      return;
    }

    /* ---------------- Log in ---------------- */
    if (action === "login") {
      const email = cleanEmail(req.body.email);
      const { password } = req.body;
      if (
        !(await rateLimit(db, `login:ip:${ip}`, 60, 900)) ||
        !(await rateLimit(db, `login:email:${email}`, 10, 900))
      ) {
        res.status(429).json({ error: "Too many login attempts. Please wait a few minutes and try again." });
        return;
      }
      const { data } = await db.from("accounts").select("*").eq("email", email).maybeSingle();
      // Same message (and same amount of work) either way so the endpoint
      // can't be used to discover which email addresses are registered.
      const ok = await verifyPassword(password, data && data.password_hash);
      if (!data || !ok) {
        res.status(401).json({ error: "Incorrect email or password." });
        return;
      }
      await db.from("accounts").update({ last_login_at: new Date().toISOString() }).eq("id", data.id);
      res.status(200).json({ account: publicAccount(data), token: issueSession(data.id, data.session_epoch || 0) });
      return;
    }

    /* ---------------- Google sign-in ---------------- */
    if (action === "google") {
      const credential = req.body.credential;
      if (!credential) { res.status(400).json({ error: "Missing Google credential" }); return; }
      if (!(await rateLimit(db, `google:ip:${ip}`, 30, 900))) {
        res.status(429).json({ error: "Too many sign-in attempts. Please try again later." });
        return;
      }

      // Fail closed: without the expected audience we cannot tell a token
      // minted for UXNest from one minted for any other Google app.
      const expectedAud = process.env.GOOGLE_CLIENT_ID;
      if (!expectedAud) {
        res.status(500).json({ error: "Server misconfigured: GOOGLE_CLIENT_ID is not set" });
        return;
      }

      // Verify the ID token with Google rather than trusting the browser.
      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
      if (!r.ok) { res.status(401).json({ error: "Google sign-in could not be verified." }); return; }
      const info = await r.json();
      if (info.aud !== expectedAud) {
        res.status(401).json({ error: "Google sign-in was issued for a different application." });
        return;
      }
      if (info.iss !== "accounts.google.com" && info.iss !== "https://accounts.google.com") {
        res.status(401).json({ error: "Google sign-in could not be verified." });
        return;
      }
      const email = cleanEmail(info.email);
      if (!isEmail(email) || !(info.email_verified === true || info.email_verified === "true")) {
        res.status(401).json({ error: "Google did not return a verified email address." });
        return;
      }

      let { data } = await db.from("accounts").select("*").eq("email", email).maybeSingle();
      if (!data) {
        const inserted = await db.from("accounts").insert({
          email,
          name: short(info.name, 120),
          provider: "google",
          email_verified: true,
          last_login_at: new Date().toISOString(),
        }).select().single();
        if (inserted.error) throw inserted.error;
        data = inserted.data;
      } else {
        await db.from("accounts").update({ last_login_at: new Date().toISOString(), email_verified: true }).eq("id", data.id);
      }
      res.status(200).json({ account: publicAccount(data), token: issueSession(data.id, data.session_epoch || 0) });
      return;
    }

    res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    console.error("[UXNest account]", e);
    res.status(500).json({ error: "Account request failed. Please try again." });
  }
}
