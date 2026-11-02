// Never derive payment return destinations from request-controlled headers.
export function trustedPaymentSuccessUrl(siteUrl = process.env.SITE_URL) {
  const configured = String(siteUrl || "https://uxnest.ai").trim();
  let url;
  try { url = new URL(configured); } catch { throw new Error("SITE_URL must be a valid HTTPS URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || !url.hostname) {
    throw new Error("SITE_URL must be an HTTPS origin without credentials, path, query or fragment.");
  }
  return new URL("/payment/success?payment=success", url.origin).toString();
}
