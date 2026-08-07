// Account endpoints: signup, login, session restore, Google sign-in.
// Passwords are hashed server-side with scrypt; the browser never sees a hash.

import {
  requireDb, hashPassword, verifyPassword, issueSession, readSession,
  cleanEmail, isEmail, publicAccount,
} from "./_lib.js";

export const maxDuration = 20;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const db = requireDb(res);
  if (!db) return;

  const { action } = req.body || {};

  try {
    /* ---------------- Restore a session ---------------- */
    if (action === "session") {
      const sess = readSession(req.body.token);
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
      const email = cleanEmail(req.body.email);
      const { password, name, company, mobile, emailVerified } = req.body;
      if (!isEmail(email)) { res.status(400).json({ error: "Enter a valid email address." }); return; }
      if (!password || String(password).length < 6) { res.status(400).json({ error: "Password must be at least 6 characters." }); return; }

      const { data: existing } = await db.from("accounts").select("id").eq("email", email).maybeSingle();
      if (existing) { res.status(409).json({ error: "An account with this email already exists — log in instead." }); return; }

      const { data, error } = await db.from("accounts").insert({
        email,
        name: (name || "").trim(),
        company: (company || "").trim(),
        mobile: (mobile || "").trim(),
        password_hash: hashPassword(password),
        email_verified: !!emailVerified,
        last_login_at: new Date().toISOString(),
      }).select().single();
      if (error) throw error;

      res.status(200).json({ account: publicAccount(data), token: issueSession(data.id) });
      return;
    }

    /* ---------------- Log in ---------------- */
    if (action === "login") {
      const email = cleanEmail(req.body.email);
      const { password } = req.body;
      const { data } = await db.from("accounts").select("*").eq("email", email).maybeSingle();
      // Same message either way so the endpoint can't be used to discover
      // which email addresses are registered.
      if (!data || !verifyPassword(password, data.password_hash)) {
        res.status(401).json({ error: "Incorrect email or password." });
        return;
      }
      await db.from("accounts").update({ last_login_at: new Date().toISOString() }).eq("id", data.id);
      res.status(200).json({ account: publicAccount(data), token: issueSession(data.id) });
      return;
    }

    /* ---------------- Google sign-in ---------------- */
    if (action === "google") {
      const credential = req.body.credential;
      if (!credential) { res.status(400).json({ error: "Missing Google credential" }); return; }

      // Verify the ID token with Google rather than trusting the browser.
      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
      if (!r.ok) { res.status(401).json({ error: "Google sign-in could not be verified." }); return; }
      const info = await r.json();
      const expectedAud = process.env.GOOGLE_CLIENT_ID;
      if (expectedAud && info.aud !== expectedAud) {
        res.status(401).json({ error: "Google sign-in was issued for a different application." });
        return;
      }
      const email = cleanEmail(info.email);
      if (!isEmail(email) || info.email_verified === "false") {
        res.status(401).json({ error: "Google did not return a verified email address." });
        return;
      }

      let { data } = await db.from("accounts").select("*").eq("email", email).maybeSingle();
      if (!data) {
        const inserted = await db.from("accounts").insert({
          email,
          name: info.name || "",
          provider: "google",
          email_verified: true,
          last_login_at: new Date().toISOString(),
        }).select().single();
        if (inserted.error) throw inserted.error;
        data = inserted.data;
      } else {
        await db.from("accounts").update({ last_login_at: new Date().toISOString() }).eq("id", data.id);
      }
      res.status(200).json({ account: publicAccount(data), token: issueSession(data.id) });
      return;
    }

    res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    res.status(500).json({ error: `Account request failed: ${(e && e.message) || "unknown error"}` });
  }
}
