// Google ID token claim checks. Do not accept tokens without an explicitly configured audience.
export function googleTokenClaimsStatus(info, clientId) {
  if (typeof clientId !== "string" || !clientId.trim()) return "misconfigured";
  if (!info || info.aud !== clientId) return "wrong_audience";
  if (info.email_verified !== true && info.email_verified !== "true") return "unverified";
  return "valid";
}
