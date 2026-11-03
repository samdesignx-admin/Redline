-- DRAFT ONLY. Do not apply to production without approval.
-- Event-state writes must be monotonic even when two signed webhook deliveries race.
-- This function serializes each event's state transition using an atomic INSERT/ON CONFLICT.
-- 'applied' is terminal; other states may be updated by later reconciliation attempts.
-- This function does NOT replace apply_creem_refund or make the event write
-- transactional with the credit reversal. A reconciliation job is still required.
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
DECLARE v_state text;
BEGIN
  IF p_event_id IS NULL OR p_event_id !~ '^evt_[A-Za-z0-9_-]+
    RAISE EXCEPTION 'Invalid refund event transition';
  END IF;
  INSERT INTO public.creem_refund_events
    (event_id, refund_id, transaction_id, amount_cents, currency,
     transaction_status, refund_status, state, detail, updated_at)
  VALUES
    (p_event_id, p_refund_id, p_transaction_id, p_amount_cents, p_currency,
     p_transaction_status, p_refund_status, p_state, p_detail, now())
  ON CONFLICT (event_id) DO UPDATE SET
    refund_id = EXCLUDED.refund_id,
    transaction_id = EXCLUDED.transaction_id,
    amount_cents = EXCLUDED.amount_cents,
    currency = EXCLUDED.currency,
    transaction_status = EXCLUDED.transaction_status,
    refund_status = EXCLUDED.refund_status,
    state = EXCLUDED.state,
    detail = EXCLUDED.detail,
    updated_at = now()
  WHERE public.creem_refund_events.state IS DISTINCT FROM 'applied';
  SELECT state INTO v_state FROM public.creem_refund_events WHERE event_id = p_event_id;
  RETURN v_state;
END;
$$;

-- Verified against live information_schema (read-only, 2026-11-02): all referenced
-- columns exist; event_id, refund_id, state and updated_at are NOT NULL.
-- NULL input guards are explicit because SQL NOT NULL boolean expressions
-- evaluate to UNKNOWN rather than TRUE inside PL/pgSQL IF.
-- Release gates:
-- 1. Inspect existing table column types, NOT NULL constraints, RLS and grants.
-- 2. Use a disposable PostgreSQL database and parallel sessions to race
--    'received' and 'applied'; assert final state = 'applied' in both orders.
-- 3. Confirm webhook service role permissions and revoke unnecessary EXECUTE.
-- 4. Exercise error recovery between credit RPC and event-state write.
-- 5. Only after approval, deploy database function BEFORE handler uses it.

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
    refund_id = EXCLUDED.refund_id,
    transaction_id = EXCLUDED.transaction_id,
    amount_cents = EXCLUDED.amount_cents,
    currency = EXCLUDED.currency,
    transaction_status = EXCLUDED.transaction_status,
    refund_status = EXCLUDED.refund_status,
    state = EXCLUDED.state,
    detail = EXCLUDED.detail,
    updated_at = now()
  WHERE public.creem_refund_events.state IS DISTINCT FROM 'applied';
  SELECT state INTO v_state FROM public.creem_refund_events WHERE event_id = p_event_id;
  RETURN v_state;
END;
$$;

-- Release gates:
-- 1. Inspect existing table column types, NOT NULL constraints, RLS and grants.
-- 2. Use a disposable PostgreSQL database and parallel sessions to race
--    'received' and 'applied'; assert final state = 'applied' in both orders.
-- 3. Confirm webhook service role permissions and revoke unnecessary EXECUTE.
-- 4. Exercise error recovery between credit RPC and event-state write.
-- 5. Only after approval, deploy database function BEFORE handler uses it.
