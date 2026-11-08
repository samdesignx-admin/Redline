-- REVIEW-ONLY DRAFT. DO NOT APPLY TO PRODUCTION WITHOUT EXPLICIT APPROVAL.
-- Atomic event persistence for signed Creem refund webhook deliveries.
-- Requires application changes to call this RPC instead of unconditional upsert.
-- Financial effects are NOT performed here. Keep automated refunds disabled.
CREATE OR REPLACE FUNCTION public.record_creem_refund_event(
  p_event_id text, p_refund_id text, p_transaction_id text,
  p_amount_cents integer, p_currency text, p_transaction_status text,
  p_refund_status text, p_state text, p_detail text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.creem_refund_events%ROWTYPE;
  v_changed boolean := false;
BEGIN
  IF p_event_id IS NULL OR p_event_id !~ '^evt_[A-Za-z0-9_-]+$'
     OR nullif(btrim(p_refund_id), '') IS NULL
     OR p_state IS NULL OR p_state NOT IN ('received','pending_link','review_required')
  THEN
    RAISE EXCEPTION 'Invalid refund event input' USING ERRCODE = '22023';
  END IF;

  -- Webhook ingestion cannot mark a refund 'applied': that state requires a separate
  -- explicitly authorized financial reconciliation path.
  -- A conflict update locks the existing row; WHERE prevents state regression.
  -- Identity changes must fail rather than silently rewrite existing evidence.
  INSERT INTO public.creem_refund_events AS e
    (event_id, refund_id, transaction_id, amount_cents, currency,
     transaction_status, refund_status, state, detail, updated_at)
  VALUES
    (p_event_id, p_refund_id, p_transaction_id, p_amount_cents, p_currency,
     p_transaction_status, p_refund_status, p_state, p_detail, now())
  ON CONFLICT (event_id) DO UPDATE
    SET state = EXCLUDED.state,
        detail = EXCLUDED.detail,
        refund_status = EXCLUDED.refund_status,
        transaction_status = EXCLUDED.transaction_status,
        updated_at = now()
    WHERE e.refund_id IS NOT DISTINCT FROM EXCLUDED.refund_id
      AND e.transaction_id IS NOT DISTINCT FROM EXCLUDED.transaction_id
      AND e.amount_cents IS NOT DISTINCT FROM EXCLUDED.amount_cents
      AND e.currency IS NOT DISTINCT FROM EXCLUDED.currency
      AND (
        (e.state = 'received' AND EXCLUDED.state IN ('pending_link','review_required'))
        OR (e.state = 'pending_link' AND EXCLUDED.state IN ('review_required'))
      )
  RETURNING * INTO v_row;

  v_changed := FOUND;
  IF NOT v_changed THEN
    SELECT * INTO v_row FROM public.creem_refund_events WHERE event_id = p_event_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Refund event persistence failed'; END IF;
    IF v_row.refund_id IS DISTINCT FROM p_refund_id
       OR v_row.transaction_id IS DISTINCT FROM p_transaction_id
       OR v_row.amount_cents IS DISTINCT FROM p_amount_cents
       OR v_row.currency IS DISTINCT FROM p_currency
    THEN
      RAISE EXCEPTION 'Conflicting refund event identity' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN jsonb_build_object('state', v_row.state, 'changed', v_changed);
END;
$$;

-- SECURITY REVIEW REQUIRED: confirm least-privilege EXECUTE grants and RLS.
-- Do not grant this RPC to anon/authenticated; it must only be used server-side.
REVOKE ALL ON FUNCTION public.record_creem_refund_event(
  text,text,text,integer,text,text,text,text,text
) FROM PUBLIC, anon, authenticated;


-- Explicitly permit only the trusted server-side Supabase service role to invoke.
-- Revoking PUBLIC also removes the implicit grant inherited by service_role.
-- SECURITY INVOKER still requires underlying table permissions and applicable RLS policies.
GRANT EXECUTE ON FUNCTION public.record_creem_refund_event(
  text,text,text,integer,text,text,text,text,text
) TO service_role;
