-- DISPOSABLE POSTGRESQL ONLY: design-level regression for refund-level uniqueness.
-- This is NOT a migration and does NOT establish atomic credit reversal.
-- A full refund is the only automated credit-reversal path currently supported.
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
-- Proposed invariant: one provider refund identity may map to only one event record.
-- Production adoption requires a data audit, legitimate retry semantics review,
-- and an approved migration; DO NOT apply this DDL outside disposable CI.
CREATE UNIQUE INDEX creem_refund_events_refund_id_unique
  ON public.creem_refund_events (refund_id);
\ir ../../docs/drafts/record-creem-refund-event-monotonic-proposal.sql
DO $test$
DECLARE s text;
BEGIN
  s := public.record_creem_refund_event('evt_one','ref_one','txn_one',500,'USD','succeeded','succeeded','received');
  IF s <> 'received' THEN RAISE EXCEPTION 'initial refund not recorded'; END IF;
  s := public.record_creem_refund_event('evt_one','ref_one','txn_one',500,'USD','succeeded','succeeded','received');
  IF s <> 'received' THEN RAISE EXCEPTION 'identical event retry not idempotent'; END IF;
  BEGIN
    PERFORM public.record_creem_refund_event('evt_two','ref_one','txn_one',500,'USD','succeeded','succeeded','received');
    RAISE EXCEPTION 'distinct event IDs accepted for the same refund';
  EXCEPTION WHEN unique_violation THEN
    NULL; -- Expected: refund-level uniqueness, not merely event-ID uniqueness.
  END;
  IF (SELECT count(*) FROM public.creem_refund_events WHERE refund_id='ref_one') <> 1 THEN
    RAISE EXCEPTION 'refund identity duplicated';
  END IF;
END
$test$;
ROLLBACK;
