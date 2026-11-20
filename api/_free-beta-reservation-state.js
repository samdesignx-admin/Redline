// Pure free-beta reservation transition rules. This module does not authorize
// Claude calls or replace atomic, durable database reservation/claim functions.
export const RESERVATION_STATES = Object.freeze([
  "reserved", "provider_started", "completed",
  "failed_before_provider", "failed_after_provider",
]);
const transitions = Object.freeze({
  reserved: Object.freeze(["provider_started", "failed_before_provider"]),
  provider_started: Object.freeze(["completed", "failed_after_provider"]),
  completed: Object.freeze([]),
  failed_before_provider: Object.freeze([]),
  failed_after_provider: Object.freeze([]),
});
const charged = new Set(["reserved", "provider_started", "completed", "failed_after_provider"]);

export function reservationCountsTowardQuota(state) {
  if (!RESERVATION_STATES.includes(state)) throw new TypeError("Invalid reservation state");
  return charged.has(state);
}

export function assertReservationTransition(from, to) {
  if (!RESERVATION_STATES.includes(from) || !RESERVATION_STATES.includes(to)) {
    throw new TypeError("Invalid reservation state");
  }
  if (!transitions[from].includes(to)) {
    throw new Error("Forbidden reservation transition");
  }
  return true;
}

export function reservationMonth(createdAt) {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid reservation timestamp");
  return date.toISOString().slice(0, 7);
}
