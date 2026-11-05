-- DISPOSABLE POSTGRESQL ONLY. Never run against production or shared Preview.
-- Usage (from repository root):
--   createdb uxnest_refund_test
--   psql -v ON_ERROR_STOP=1 -d uxnest_refund_test -f tests/sql/creem-refund-event-regression.sql
-- Database must be newly created and empty. Script rolls back its own changes.
\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE public.creem_refund_events (
  event_id text PRIMARY KEY,
  refund_id text NOT NULL,
  transaction_id text,
  amount_cents integer,
  currency text,
  transaction_status text,
  refund_status text,
  state text NOT NULL,
  detail text,
  updated_at timestamptz
);
\ir ../../docs/drafts/record-creem-refund-event-monotonic-proposal.sql
DO $test$
DECLARE s text;
BEGIN
  s := public.record_creem_refund_event('evt1','ref1','txn1',500,'USD','succeeded','succeeded','received');
  IF s <> 'received' THEN RAISE EXCEPTION 'initial insert failed'; END IF;
  s := public.record_creem_refund_event('evt1','ref1','txn1',500,'USD','succeeded','succeeded','review_required');
  IF s <> 'review_required' THEN RAISE EXCEPTION 'review hold failed'; END IF;
  s := public.record_creem_refund_event('evt1','ref1','txn1',500,'USD','succeeded','succeeded','received');
  IF s <> 'review_required' THEN RAISE EXCEPTION 'review hold cleared by replay'; END IF;
  s := public.record_creem_refund_event('evt1','ref1','txn1',500,'USD','succeeded','succeeded','applied');
  IF s <> 'review_required' THEN RAISE EXCEPTION 'review hold bypassed'; END IF;
  BEGIN
    PERFORM public.record_creem_refund_event('evt1','ref2','txn1',500,'USD','succeeded','succeeded','received');
    RAISE EXCEPTION 'changed refund ID accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'Refund event ID belongs to another refund' THEN
      RAISE EXCEPTION 'Unexpected rejection for changed refund ID accepted: %', SQLERRM;
    END IF;
  END;
  BEGIN
    PERFORM public.record_creem_refund_event('evt1','ref1','txn1',501,'USD','succeeded','succeeded','received');
    RAISE EXCEPTION 'changed amount accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'Refund event identity fields changed on replay' THEN
      RAISE EXCEPTION 'Unexpected rejection for changed amount accepted: %', SQLERRM;
    END IF;
  END;
  BEGIN
    PERFORM public.record_creem_refund_event('evt1','ref1','txn1',500,'EUR','succeeded','succeeded','received');
    RAISE EXCEPTION 'changed currency accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'Refund event identity fields changed on replay' THEN
      RAISE EXCEPTION 'Unexpected rejection for changed currency accepted: %', SQLERRM;
    END IF;
  END;
  s := public.record_creem_refund_event('evt2','ref2','txn2',500,'USD','succeeded','succeeded','applied');
  s := public.record_creem_refund_event('evt2','ref2','txn2',500,'USD','succeeded','succeeded','received');
  IF s <> 'applied' THEN RAISE EXCEPTION 'terminal applied state regressed'; END IF;
  IF (SELECT count(*) FROM public.creem_refund_events) <> 2 THEN
    RAISE EXCEPTION 'unexpected event count';
  END IF;
END
$test$;
ROLLBACK;
-- TODO: separate two-session concurrency test and credit-reversal atomicity test.
