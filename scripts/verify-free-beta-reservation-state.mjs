import assert from "node:assert/strict";
import test from "node:test";
import {
  RESERVATION_STATES, assertReservationTransition,
  reservationCountsTowardQuota, reservationMonth,
} from "../api/_free-beta-reservation-state.js";

test("only explicitly permitted state transitions are accepted", () => {
  const allowed = new Set([
    "reserved:provider_started", "reserved:failed_before_provider",
    "provider_started:completed", "provider_started:failed_after_provider",
  ]);
  for (const from of RESERVATION_STATES) {
    for (const to of RESERVATION_STATES) {
      if (allowed.has(`${from}:${to}`)) {
        assert.equal(assertReservationTransition(from, to), true);
      } else {
        assert.throws(() => assertReservationTransition(from, to), /Forbidden/);
      }
    }
  }
});

test("unknown states are rejected fail-closed", () => {
  assert.throws(() => reservationCountsTowardQuota("pending"), TypeError);
  assert.throws(() => assertReservationTransition("pending", "completed"), TypeError);
  assert.throws(() => assertReservationTransition("reserved", "refunded"), TypeError);
});

test("provider-started failures continue consuming quota", () => {
  for (const state of ["reserved", "provider_started", "completed", "failed_after_provider"]) {
    assert.equal(reservationCountsTowardQuota(state), true);
  }
  assert.equal(reservationCountsTowardQuota("failed_before_provider"), false);
});

test("reservation month remains based on original UTC creation time", () => {
  assert.equal(reservationMonth("2026-11-30T23:59:59.999Z"), "2026-11");
  assert.equal(reservationMonth("2026-12-01T00:00:00.000Z"), "2026-12");
  assert.equal(reservationMonth("2026-12-01T01:00:00+02:00"), "2026-11");
  assert.throws(() => reservationMonth("invalid"), TypeError);
});
