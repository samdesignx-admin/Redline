const SITE_URL = "https://uxnest.ai";

const SCREEN_LIMIT = 5;
const NAV_LIMIT = 5;
// Legacy client-side display quota. Do not raise this to 3 until the server
// enforces the monthly allowance atomically; client checks are not security.
const AUDIT_QUOTA = 1;
const AUDIT_PRICE_USD = 10;
const BETA_DISCOUNT_PERCENT = 50;
const BETA_AUDIT_PRICE_USD = AUDIT_PRICE_USD * (1 - BETA_DISCOUNT_PERCENT / 100);
// Avoid inviting purchases during free beta. This is copy-only; purchase
// controls and checkout endpoints must still be gated server-side.
const QUOTA_MESSAGE = "Your current audit allowance has been used. Additional free beta audits are not yet available; please check back later.";

export { SITE_URL, SCREEN_LIMIT, NAV_LIMIT, AUDIT_QUOTA, AUDIT_PRICE_USD, BETA_DISCOUNT_PERCENT, BETA_AUDIT_PRICE_USD, QUOTA_MESSAGE };
