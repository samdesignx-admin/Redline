const SITE_URL = "https://uxnest.ai";

const SCREEN_LIMIT = 5;
const NAV_LIMIT = 5;
const AUDIT_QUOTA = 1; // one complete audit included per account
const AUDIT_PRICE_USD = 10;
const BETA_DISCOUNT_PERCENT = 50;
const BETA_AUDIT_PRICE_USD = AUDIT_PRICE_USD * (1 - BETA_DISCOUNT_PERCENT / 100);
const QUOTA_MESSAGE = "Your free audit has been used. Purchase additional audits for $5 each during beta.";

export { SITE_URL, SCREEN_LIMIT, NAV_LIMIT, AUDIT_QUOTA, AUDIT_PRICE_USD, BETA_DISCOUNT_PERCENT, BETA_AUDIT_PRICE_USD, QUOTA_MESSAGE };
