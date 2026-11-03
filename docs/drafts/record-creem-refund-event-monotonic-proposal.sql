-- DRAFT ONLY: do not apply to production without explicit approval.
-- Proposed atomic, monotonic event-state recorder; requires isolated PostgreSQL tests.
-- 'applied' is terminal. Prevent event ID reuse for a different refund.
-- This does NOT make credit reversal and event recording one transaction.
CREATE OR REPLACE FUNCTION public.record_creem_refund_event(
  p_event_id text,
  p_refund_id text,
  p_transaction_id text,
  p_amount_cents integer,
  p_currency text,
  p_transaction_status text,
  p_refund_status text,
  p_state text,
  p_detail text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_state text;
  v_refund_id text;
BEGIN
  IF p_event_id IS NULL OR btrim(p_event_id) = ''
     OR p_refund_id IS NULL OR btrim(p_refund_id) = ''
     OR p_state IS NULL
     OR p_state NOT IN ('received', 'review_required', 'pending_link', 'applied') THEN
    RAISE EXCEPTION 'Invalid refund event transition';
  END IF;

  INSERT INTO public.creem_refund_events
    (event_id, refund_id, transaction_id, amount_cents, currency,
     transaction_status, refund_status, state, detail, updated_at)
  VALUES
    (p_event_id, p_refund_id, p_transaction_id, p_amount_cents, p_currency,
     p_transaction_status, p_refund_status, p_state, p_detail, now())
  ON CONFLICT (event_id) DO UPDATE SET
    transaction_id = EXCLUDED.transaction_id,
    amount_cents = EXCLUDED.amount_cents,
    currency = EXCLUDED.currency,
    transaction_status = EXCLUDED.transaction_status,
    refund_status = EXCLUDED.refund_status,
    state = EXCLUDED.state,
    detail = EXCLUDED.detail,
    updated_at = now()
  WHERE public.creem_refund_events.state IS DISTINCT FROM 'applied'
    AND public.creem_refund_events.refund_id = EXCLUDED.refund_id;

  SELECT state, refund_id INTO v_state, v_refund_id
  FROM public.creem_refund_events WHERE event_id = p_event_id;

  IF v_refund_id IS DISTINCT FROM p_refund_id THEN
    RAISE EXCEPTION 'Refund event ID belongs to another refund';
  END IF;
  RETURN v_state;
END;
$$;

-- Schema checked read-only on 2026-11-02: all referenced columns exist.
-- RELEASE GATES:
-- 1. Test syntax and concurrency with parallel sessions in disposable PostgreSQL.
-- 2. Verify service-role permissions, RLS and EXECUTE grants; restrict access.
-- 3. Test reconciliation after credit reversal succeeds but event write fails.
-- 4. Integrate handler only after approved database migration is deployed.
