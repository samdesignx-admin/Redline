import assert from "node:assert/strict";
import test from "node:test";
import { FREE_BETA_MONTHLY_AUDITS, utcMonthWindow, monthlyQuota } from "../api/_free-beta-quota.js";

test("free beta policy is three audits per UTC calendar month", () => {
  assert.equal(FREE_BETA_MONTHLY_AUDITS, 3);
  assert.deepEqual(monthlyQuota(0), { quota: 3, used: 0, remaining: 3 });
  assert.deepEqual(monthlyQuota(2), { quota: 3, used: 2, remaining: 1 });
  assert.deepEqual(monthlyQuota(3), { quota: 3, used: 3, remaining: 0 });
  assert.deepEqual(monthlyQuota(9), { quota: 3, used: 9, remaining: 0 });
});

test("month windows are UTC, start-inclusive and end-exclusive", () => {
  assert.deepEqual(utcMonthWindow("2026-11-19T05:15:00Z"), {
    start: "2026-11-01T00:00:00.000Z",
    end: "2026-12-01T00:00:00.000Z",
  });
  assert.deepEqual(utcMonthWindow("2028-02-29T23:59:59Z"), {
    start: "2028-02-01T00:00:00.000Z",
    end: "2028-03-01T00:00:00.000Z",
  });
  assert.deepEqual(utcMonthWindow("2026-12-31T23:59:59Z"), {
    start: "2026-12-01T00:00:00.000Z",
    end: "2027-01-01T00:00:00.000Z",
  });
});

test("rejects malformed counts and dates rather than silently granting audits", () => {
  for (const used of [-1, 0.5, "1", NaN, Infinity]) {
    assert.throws(() => monthlyQuota(used), TypeError);
  }
  assert.throws(() => utcMonthWindow("not a date"), TypeError);
});
