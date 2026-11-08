-- DISPOSABLE POSTGRES ONLY. Run after applying creem-refund-event-atomic-DRAFT.sql
-- against a throwaway database with the matching creem_refund_events schema.
-- Never run against production: this script inserts fixture refund events.
-- Execute with psql -v ON_ERROR_STOP=1 -f docs/sql/creem-refund-event-regression.sql
BEGIN;
DO $$
DECLARE
  v jsonb;
  v_state text;
  v_rejected boolean := false;
BEGIN
  v := public.record_creem_refund_event(
    'evt_regression_001','ref_regression_001','txn_regression_001',
    500,'USD','succeeded','pending','received','initial');
  IF v->>'state' <> 'received' OR (v->>'changed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Initial event insert failed: %', v;
  END IF;

  v := public.record_creem_refund_event(
    'evt_regression_001','ref_regression_001','txn_regression_001',
    500,'USD','succeeded','succeeded','review_required','manual review');
  IF v->>'state' <> 'review_required' THEN
    RAISE EXCEPTION 'Forward transition failed: %', v;
  END IF;

  v := public.record_creem_refund_event(
    'evt_regression_001','ref_regression_001','txn_regression_001',
    500,'USD','succeeded','pending','received','stale replay');
  IF v->>'state' <> 'review_required' OR (v->>'changed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Stale replay changed state: %', v;
  END IF;

  -- Repeated deliveries at the same nonterminal state must be idempotent.
  -- Use a separate event to ensure the duplicate does not replace evidence.
  v := public.record_creem_refund_event(
    'evt_regression_duplicate','ref_regression_duplicate','txn_regression_duplicate',
    500,'USD','succeeded','pending','received','original evidence');
  v := public.record_creem_refund_event(
    'evt_regression_duplicate','ref_regression_duplicate','txn_regression_duplicate',
    500,'USD','succeeded','succeeded','received','duplicate evidence');
  IF v->>'state' <> 'received' OR (v->>'changed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Same-state duplicate unexpectedly updated: %', v;
  END IF;
  IF (SELECT detail FROM public.creem_refund_events WHERE event_id='evt_regression_duplicate') <> 'original evidence' THEN
    RAISE EXCEPTION 'Same-state duplicate overwrote audit evidence';
  END IF;

  -- A pending-link event must not regress to received on stale replay.
  v := public.record_creem_refund_event(
    'evt_regression_duplicate','ref_regression_duplicate','txn_regression_duplicate',
    500,'USD','succeeded','pending','pending_link','link pending');
  v := public.record_creem_refund_event(
    'evt_regression_duplicate','ref_regression_duplicate','txn_regression_duplicate',
    500,'USD','succeeded','pending','received','stale received');
  IF v->>'state' <> 'pending_link' OR (v->>'changed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Pending-link state regressed: %', v;
  END IF;

  -- A duplicate at the terminal review state must not mutate audit evidence.
  v := public.record_creem_refund_event(
    'evt_regression_001','ref_regression_001','txn_regression_001',
    500,'USD','succeeded','pending','review_required','duplicate payload');
  IF v->>'state' <> 'review_required' OR (v->>'changed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Duplicate terminal event unexpectedly updated: %', v;
  END IF;
  IF (SELECT detail FROM public.creem_refund_events WHERE event_id='evt_regression_001') <> 'manual review' THEN
    RAISE EXCEPTION 'Duplicate event overwrote review evidence';
  END IF;

  -- Explicitly reject null states rather than relying on SQL NULL comparisons.
  v_rejected := false;
  BEGIN
    PERFORM public.record_creem_refund_event(
      'evt_regression_001','ref_regression_001','txn_regression_001',
      500,'USD','succeeded','pending',NULL,'null state');
  EXCEPTION WHEN invalid_parameter_value THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Webhook accepted null refund state';
  END IF;

  SELECT state INTO v_state FROM public.creem_refund_events
    WHERE event_id='evt_regression_001';
  IF v_state <> 'review_required' THEN
    RAISE EXCEPTION 'Persisted state regressed to %', v_state;
  END IF;

  -- Reset rejection flag so identity protection is independently asserted.
  v_rejected := false;
  BEGIN
    PERFORM public.record_creem_refund_event(
      'evt_regression_001','ref_different','txn_regression_001',
      500,'USD','succeeded','succeeded','review_required','identity collision');
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Conflicting immutable refund ID was accepted';
  END IF;

  -- Invalid state is tested separately from immutable identity conflicts.
  v_rejected := false;
  BEGIN
    PERFORM public.record_creem_refund_event(
      'evt_regression_001','ref_regression_001','txn_regression_001',
      500,'USD','succeeded','succeeded','applied','unauthorized applied state');
  EXCEPTION WHEN invalid_parameter_value THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Webhook incorrectly accepted applied state';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.record_creem_refund_event(
      'evt_regression_new_applied','ref_regression_new','txn_regression_new',
      500,'USD','succeeded','succeeded','applied','unauthorized initial state');
  EXCEPTION WHEN invalid_parameter_value THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Webhook incorrectly inserted applied state';
  END IF;

  RAISE NOTICE 'Sequential refund replay/identity regression checks passed';
END $$;
ROLLBACK;
-- Separate concurrent-session tests remain REQUIRED: this only tests sequential behavior.
