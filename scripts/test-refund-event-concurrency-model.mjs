import assert from "node:assert/strict";

// Deterministic model of the current webhook event-state operations.
// This is a race reproduction, not a database integration test.
// Both deliveries read "received" before either finishes the refund RPC.
const events = new Map([["evt_concurrent_001", "received"]]);
const readState = async id => events.get(id);
const upsertState = async (id, state) => { events.set(id, state); };
const id = "evt_concurrent_001";
const firstRead = await readState(id);
const secondRead = await readState(id);
assert.equal(firstRead, "received");
assert.equal(secondRead, "received");

// Delivery A completes its RPC and marks the event applied.
await upsertState(id, "applied");
assert.equal(events.get(id), "applied");

// Delivery B's delayed, unconditional 'received' upsert regresses state.
await upsertState(id, "received");
assert.equal(events.get(id), "received", "Reproduces the known event-state regression");

// Desired invariant for a future atomic database implementation.
const rank = { received: 0, pending_link: 1, review_required: 1, applied: 2 };
const monotonicTransition = (previous, next) =>
  rank[next] >= rank[previous] ? next : previous;
assert.equal(monotonicTransition("applied", "received"), "applied");
assert.equal(monotonicTransition("received", "applied"), "applied");
console.log("Concurrent refund event-state race reproduced; monotonic transition invariant verified (model only).");
