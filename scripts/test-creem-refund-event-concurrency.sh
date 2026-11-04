#!/usr/bin/env bash
# ONLY run against an ephemeral, disposable PostgreSQL database.
set -euo pipefail
: "${PGDATABASE:?PGDATABASE must name an isolated disposable database}"
if [[ "$PGDATABASE" != "refund_test" ]]; then
  echo "Refusing to run: PGDATABASE must be refund_test (disposable CI database)." >&2
  exit 2
fi
psql -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE public.creem_refund_events (
 event_id text PRIMARY KEY, refund_id text NOT NULL, transaction_id text,
 amount_cents integer, currency text, transaction_status text,
 refund_status text, state text NOT NULL, detail text,
 received_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
\i docs/drafts/record-creem-refund-event-monotonic-proposal.sql
SQL
replay_log=$(mktemp)
cleanup() {
  rm -f "$replay_log"
  psql -X -v ON_ERROR_STOP=1 -c 'DROP FUNCTION IF EXISTS public.record_creem_refund_event(text,text,text,integer,text,text,text,text,text); DROP TABLE IF EXISTS public.creem_refund_events;' >/dev/null || true
}
trap cleanup EXIT
# Session A writes applied but holds its transaction open; session B races a
# received replay for the SAME event. ON CONFLICT must serialize the writers.
psql -X -v ON_ERROR_STOP=1 <<'SQL' &
BEGIN;
SELECT public.record_creem_refund_event('evt_race','refund_A','tx_A',500,'USD',NULL,NULL,'applied');
SELECT pg_sleep(2);
COMMIT;
SQL
first=$!
sleep 0.5
# Conflicting identity must be rejected. Capture the expected failure without
# masking unexpected SQL errors or the outcome of session A.
(
  if psql -X -v ON_ERROR_STOP=1 <<'SQL' >"$replay_log" 2>&1; then
SELECT public.record_creem_refund_event('evt_race','refund_A','tx_mutated',999,'EUR',NULL,NULL,'received');
SQL
    echo 'ERROR: conflicting replay unexpectedly succeeded' >&2
    exit 1
  fi
  if ! grep -Fq 'ERROR:  Refund event identity fields changed on replay' "$replay_log"; then
    cat "$replay_log" >&2
    echo 'ERROR: replay failed for an unexpected reason' >&2
    exit 1
  fi
) &
second=$!
wait "$first"
wait "$second"
psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
 IF (SELECT count(*) FROM public.creem_refund_events WHERE event_id='evt_race') <> 1
 OR NOT EXISTS (SELECT 1 FROM public.creem_refund_events WHERE event_id='evt_race'
   AND refund_id='refund_A' AND state='applied'
   AND transaction_id='tx_A' AND amount_cents=500 AND currency='USD') THEN
   RAISE EXCEPTION 'Concurrent replay regressed applied state or metadata';
 END IF;
END $$;
SQL
echo "PASS: concurrent received replay cannot regress committed applied event"
