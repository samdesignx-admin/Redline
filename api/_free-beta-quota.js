// Free-beta quota policy. Calendar months are measured in UTC.
export const FREE_BETA_MONTHLY_AUDITS = 3;

export function utcMonthWindow(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid date");
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1)).toISOString(),
    end: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
  };
}

export function monthlyQuota(used) {
  if (!Number.isSafeInteger(used) || used < 0) throw new TypeError("Invalid audit count");
  return {
    quota: FREE_BETA_MONTHLY_AUDITS,
    used,
    remaining: Math.max(0, FREE_BETA_MONTHLY_AUDITS - used),
  };
}
