// Never derive payment return destinations from request-controlled headers.
export function trustedPaymentSuccessUrl(siteUrl = process.env.SITE_URL, environment = process.env.VERCEL_ENV) {
  const configured = String(siteUrl ?? "").trim();
  // Preview/development must never silently return customers to production.
  if (!configured && environment && environment !== "production") {
    throw new Error("SITE_URL must be configured for non-production payment checkout.");
  }
  const origin = configured || "https://uxnest.ai";
  let url;
  try { url = new URL(origin); } catch { throw new Error("SITE_URL must be a valid HTTPS URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || !url.hostname) {
    throw new Error("SITE_URL must be an HTTPS origin without credentials, path, query or fragment.");
  }
  return new URL("/payment/success?payment=success", url.origin).toString();
}
