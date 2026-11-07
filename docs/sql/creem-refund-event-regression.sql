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

  SELECT state INTO v_state FROM public.creem_refund_events
    WHERE event_id='evt_regression_001';
  IF v_state <> 'review_required' THEN
    RAISE EXCEPTION 'Persisted state regressed to %', v_state;
  END IF;

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
