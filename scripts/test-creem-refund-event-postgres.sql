-- DISPOSABLE POSTGRESQL DATABASE ONLY. NEVER RUN AGAINST UXNEST PRODUCTION.
-- Run from repository root:
-- psql -X -v ON_ERROR_STOP=1 -d "$DISPOSABLE_DATABASE_URL" -f scripts/test-creem-refund-event-postgres.sql
-- Sequential integration checks; separate parallel-session tests still required.
BEGIN;
CREATE TABLE public.creem_refund_events (
 event_id text PRIMARY KEY, refund_id text NOT NULL, transaction_id text,
 amount_cents integer, currency text, transaction_status text,
 refund_status text, state text NOT NULL, detail text,
 received_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
\ir ../docs/drafts/record-creem-refund-event-monotonic-proposal.sql
DO $test$
DECLARE result text;
BEGIN
 result := public.record_creem_refund_event('event-1','refund-1','tx-1',500,'USD',NULL,NULL,'received');
 IF result IS DISTINCT FROM 'received' THEN RAISE EXCEPTION 'Initial insert failed'; END IF;
 result := public.record_creem_refund_event('event-1','refund-1','tx-1',500,'USD',NULL,NULL,'applied');
 IF result IS DISTINCT FROM 'applied' THEN RAISE EXCEPTION 'Apply failed'; END IF;
 result := public.record_creem_refund_event('event-1','refund-1','tx-1',500,'USD',NULL,NULL,'received');
 IF result IS DISTINCT FROM 'applied' THEN RAISE EXCEPTION 'Terminal state regressed'; END IF;
 BEGIN
   PERFORM public.record_creem_refund_event('event-1','refund-OTHER','tx-1',500,'USD',NULL,NULL,'received');
   RAISE EXCEPTION 'Refund identity mismatch accepted';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM = 'Refund identity mismatch accepted' THEN RAISE; END IF;
 END;
 BEGIN
   PERFORM public.record_creem_refund_event(NULL,'refund-1',NULL,NULL,NULL,NULL,NULL,'received');
   RAISE EXCEPTION 'Null event ID accepted';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM = 'Null event ID accepted' THEN RAISE; END IF;
 END;
END
$test$;
ROLLBACK;
