#!/usr/bin/env bash
set -euo pipefail
# Disposable PostgreSQL only. Never point PG* variables at production.
: "${PGDATABASE:?Set PGDATABASE to a disposable test database}"
if [[ "$PGDATABASE" != "refund_regression" ]]; then
  echo "Refusing to run against non-disposable database: $PGDATABASE" >&2
  exit 2
fi
rpc() {
  local state="$1"
  psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT public.record_creem_refund_event('evt_concurrent_01','refund_concurrent_01','txn_concurrent_01',500,'USD','refunded','succeeded','$state','concurrency test');" >/dev/null
}
rpc received
pids=()
for i in $(seq 1 20); do
  if (( i % 3 == 0 )); then state=review_required; else state=pending_link; fi
  rpc "$state" &
  pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
state=$(psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT state FROM public.creem_refund_events WHERE event_id='evt_concurrent_01'")
[[ "$state" == "review_required" ]] || { echo "State regressed: $state" >&2; exit 1; }
count=$(psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM public.creem_refund_events WHERE event_id='evt_concurrent_01'")
[[ "$count" == "1" ]] || { echo "Duplicate event rows: $count" >&2; exit 1; }
rpc received
state=$(psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT state FROM public.creem_refund_events WHERE event_id='evt_concurrent_01'")
[[ "$state" == "review_required" ]] || { echo "Delayed event regressed state" >&2; exit 1; }
if psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT public.record_creem_refund_event('evt_concurrent_01','different_refund','txn_concurrent_01',500,'USD','refunded','succeeded','review_required','conflicting identity');" >/dev/null 2>&1; then
  echo "Conflicting identity was accepted" >&2; exit 1
fi
echo "PASS: 20 concurrent PostgreSQL calls; one row, monotonic state, conflicting identity rejected"

# Failure injection: an error after the RPC in the same transaction must
# roll back the event insert, rather than leaving a partially persisted event.
# psql must fail here; a successful exit would mean the injection did not fire.
if psql -X -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
BEGIN;
SELECT public.record_creem_refund_event(
  'evt_rollback_01','refund_rollback_01','txn_rollback_01',
  500,'USD','refunded','succeeded','review_required','rollback test');
SELECT 1 / 0; -- intentional transaction failure
COMMIT;
SQL
then
  echo "Failure injection unexpectedly succeeded" >&2
  exit 1
fi
rollback_count=$(psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM public.creem_refund_events WHERE event_id='evt_rollback_01'")
[[ "$rollback_count" == "0" ]] || { echo "Failed transaction persisted refund event" >&2; exit 1; }
echo "PASS: injected transaction failure rolls back refund event"

