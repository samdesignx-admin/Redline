-- DISPOSABLE POSTGRESQL DATABASE ONLY. NEVER RUN AGAINST UXNEST PRODUCTION.
-- Run from repository root:
-- psql -X -v ON_ERROR_STOP=1 -d "$DISPOSABLE_DATABASE_URL" -f scripts/test-creem-refund-event-postgres.sql
-- Sequential integration checks; separate parallel-session tests still required.
-- Expected-failure assertions check exact messages so unrelated SQL errors cannot masquerade as passing tests.
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
 -- A terminal event must remain applied even if a replay supplies altered metadata.
 result := public.record_creem_refund_event('event-1','refund-1','tx-MUTATED',999,'EUR',NULL,NULL,'review_required');
 IF result IS DISTINCT FROM 'applied' THEN RAISE EXCEPTION 'Terminal event changed state'; END IF;
 IF EXISTS (SELECT 1 FROM public.creem_refund_events
            WHERE event_id='event-1' AND
              (transaction_id IS DISTINCT FROM 'tx-1'
               OR amount_cents IS DISTINCT FROM 500
               OR currency IS DISTINCT FROM 'USD'
               OR state IS DISTINCT FROM 'applied'))
 THEN RAISE EXCEPTION 'Terminal event metadata was mutated'; END IF;
 -- A webhook can arrive with its first observed state already applied.
 result := public.record_creem_refund_event('event-applied-first','refund-2','tx-2',700,'USD',NULL,NULL,'applied');
 IF result IS DISTINCT FROM 'applied' THEN RAISE EXCEPTION 'Initial applied event failed'; END IF;
 result := public.record_creem_refund_event('event-applied-first','refund-2','tx-mutated',701,'EUR',NULL,NULL,'pending_link');
 IF result IS DISTINCT FROM 'applied' THEN RAISE EXCEPTION 'Applied-first event regressed'; END IF;
 IF EXISTS (SELECT 1 FROM public.creem_refund_events
            WHERE event_id='event-applied-first' AND
              (transaction_id IS DISTINCT FROM 'tx-2'
               OR amount_cents IS DISTINCT FROM 700
               OR currency IS DISTINCT FROM 'USD'
               OR state IS DISTINCT FROM 'applied'))
 THEN RAISE EXCEPTION 'Applied-first event metadata mutated'; END IF;
 -- A different refund must not reuse an event ID even before it is terminal.
 result := public.record_creem_refund_event('event-pending','refund-3',NULL,NULL,NULL,NULL,NULL,'pending_link');
 IF result IS DISTINCT FROM 'pending_link' THEN RAISE EXCEPTION 'Pending event insert failed'; END IF;
 BEGIN
   PERFORM public.record_creem_refund_event('event-pending','refund-OTHER',NULL,NULL,NULL,NULL,NULL,'received');
   RAISE EXCEPTION 'Nonterminal refund identity mismatch accepted';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM IS DISTINCT FROM 'Refund event ID belongs to another refund' THEN
     RAISE EXCEPTION 'Unexpected error while checking Nonterminal refund identity mismatch accepted: %', SQLERRM;
   END IF;
 END;
 -- Invalid states and blank identities must be rejected.
 BEGIN
   PERFORM public.record_creem_refund_event('event-invalid','refund-1',NULL,NULL,NULL,NULL,NULL,'unknown');
   RAISE EXCEPTION 'Invalid state accepted';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM IS DISTINCT FROM 'Invalid refund event transition' THEN
     RAISE EXCEPTION 'Unexpected error while checking Invalid state accepted: %', SQLERRM;
   END IF;
 END;
 BEGIN
   PERFORM public.record_creem_refund_event('   ','refund-1',NULL,NULL,NULL,NULL,NULL,'received');
   RAISE EXCEPTION 'Blank event ID accepted';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM IS DISTINCT FROM 'Invalid refund event transition' THEN
     RAISE EXCEPTION 'Unexpected error while checking Blank event ID accepted: %', SQLERRM;
   END IF;
 END;
 BEGIN
   PERFORM public.record_creem_refund_event('event-1','refund-OTHER','tx-1',500,'USD',NULL,NULL,'received');
   RAISE EXCEPTION 'Refund identity mismatch accepted';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM IS DISTINCT FROM 'Refund event ID belongs to another refund' THEN
     RAISE EXCEPTION 'Unexpected error while checking Refund identity mismatch accepted: %', SQLERRM;
   END IF;
 END;
 BEGIN
   PERFORM public.record_creem_refund_event(NULL,'refund-1',NULL,NULL,NULL,NULL,NULL,'received');
   RAISE EXCEPTION 'Null event ID accepted';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM IS DISTINCT FROM 'Invalid refund event transition' THEN
     RAISE EXCEPTION 'Unexpected error while checking Null event ID accepted: %', SQLERRM;
   END IF;
 END;
END
$test$;
ROLLBACK;
