import crypto from "node:crypto";

export function validSignupProof(email, token, code, secret, now = Date.now()) {
  if (!secret || typeof secret !== "string" || secret.length < 16) return false;
  if (typeof token !== "string" || typeof code !== "string" || !/^\\d{6}$/.test(code.trim())) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "signup") return false;
  const [, expiryText, signature] = parts;
  if (!/^\\d{13}$/.test(expiryText) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expiry = Number(expiryText);
  if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > now + 10 * 60 * 1000) return false;
  const normalized = String(email || "").trim().toLowerCase();
  const expected = crypto.createHmac("sha256", secret)
    .update(`${normalized}.signup.${code.trim()}.${expiry}`).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
