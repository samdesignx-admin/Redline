-- UXNest security & correctness hardening.
-- Run AFTER db/schema.sql and 20260926_creem_audit_payments.sql, and BEFORE
-- deploying the matching API code (the API calls the functions defined here).
-- Safe to re-run.

------------------------------------------------------------------------
-- 1. Creem purchases never have a Stripe session id. The original schema made
--    that column NOT NULL, which made every Creem grant fail.
------------------------------------------------------------------------
alter table audit_purchases alter column stripe_session_id drop not null;

------------------------------------------------------------------------
-- 2. Session revocation: bumping this on password reset invalidates every
--    previously issued session token for the account.
------------------------------------------------------------------------
alter table accounts add column if not exists session_epoch integer not null default 0;

------------------------------------------------------------------------
-- 3. Durable, cross-instance rate limiting.
------------------------------------------------------------------------
create table if not exists rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  count        integer not null default 0
);
alter table rate_limits enable row level security;

-- Returns true when the call is within the limit for the current window.
create or replace function hit_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if random() < 0.01 then
    delete from rate_limits where window_start < now() - interval '1 day';
  end if;

  insert into rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when r.window_start <= now() - make_interval(secs => p_window_seconds)
                        then now() else r.window_start end,
    count        = case when r.window_start <= now() - make_interval(secs => p_window_seconds)
                        then 1 else r.count + 1 end
  returning r.count into v_count;

  return v_count <= p_limit;
end;
$$;

------------------------------------------------------------------------
-- 4. Atomic credit consumption + audit insert. One statement decides whether
--    the account has a free or paid credit and spends it, so concurrent
--    requests cannot double-spend, and a failed insert rolls the credit back.
--    Returns NULL when the account has no credit left.
------------------------------------------------------------------------
create or replace function create_audit_with_credit(
  p_account_id uuid,
  p_free_quota integer,
  p_audit jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used  integer;
  v_paid  integer;
  v_audit audits;
begin
  update accounts
  set audits_used = case when audits_used < p_free_quota then audits_used + 1 else audits_used end,
      paid_audits = case when audits_used < p_free_quota then paid_audits else paid_audits - 1 end
  where id = p_account_id
    and (audits_used < p_free_quota or paid_audits > 0)
  returning audits_used, paid_audits into v_used, v_paid;

  if not found then
    return null;
  end if;

  insert into audits (
    account_id, title, mode, url, screen_count, score, assessment,
    scorecard, severities, pages, raw_text
  ) values (
    p_account_id,
    left(p_audit->>'title', 300),
    coalesce(nullif(left(p_audit->>'mode', 20), ''), 'files'),
    left(p_audit->>'url', 2048),
    coalesce((p_audit->>'screen_count')::integer, 0),
    case when jsonb_typeof(p_audit->'score') = 'number' then round((p_audit->>'score')::numeric)::integer end,
    left(p_audit->>'assessment', 2000),
    case when jsonb_typeof(p_audit->'scorecard')  in ('object','array') then p_audit->'scorecard'  end,
    case when jsonb_typeof(p_audit->'severities') in ('object','array') then p_audit->'severities' end,
    case when jsonb_typeof(p_audit->'pages')      in ('object','array') then p_audit->'pages'      end,
    left(p_audit->>'raw_text', 60000)
  )
  returning * into v_audit;

  return jsonb_build_object('audit', to_jsonb(v_audit), 'used', v_used, 'paid', v_paid);
end;
$$;

------------------------------------------------------------------------
-- 5. Purchase grant: validate inputs inside the function too, so it is safe
--    even if called by something other than our API.
------------------------------------------------------------------------
create or replace function grant_creem_audit_purchase(
  p_account_id uuid,
  p_checkout_id text,
  p_event_id text,
  p_amount_cents integer,
  p_quantity integer,
  p_currency text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 20 then
    raise exception 'invalid purchase quantity' using errcode = '22023';
  end if;
  if p_checkout_id is null or length(p_checkout_id) = 0 then
    raise exception 'missing checkout id' using errcode = '22023';
  end if;

  insert into audit_purchases (
    account_id, creem_checkout_id, creem_event_id,
    amount_cents, quantity, currency, payment_provider
  ) values (
    p_account_id, p_checkout_id, p_event_id,
    p_amount_cents, p_quantity, lower(coalesce(p_currency, 'usd')), 'creem'
  );

  update accounts
  set paid_audits = greatest(0, coalesce(paid_audits, 0) + p_quantity)
  where id = p_account_id;

  return true;
exception
  when unique_violation then
    return false;
end;
$$;

------------------------------------------------------------------------
-- 6. Remove the unused credit-minting helper.
------------------------------------------------------------------------
drop function if exists increment_paid_audits(uuid, integer);

------------------------------------------------------------------------
-- 7. Lock the functions down. Postgres grants EXECUTE to PUBLIC by default and
--    Supabase exposes public-schema functions over its REST API, so without
--    this anyone holding the (public) anon key could call these and mint
--    credits. Only the server's service_role may run them.
------------------------------------------------------------------------
revoke all on function hit_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function create_audit_with_credit(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function grant_creem_audit_purchase(uuid, text, text, integer, integer, text) from public, anon, authenticated;

grant execute on function hit_rate_limit(text, integer, integer) to service_role;
grant execute on function create_audit_with_credit(uuid, integer, jsonb) to service_role;
grant execute on function grant_creem_audit_purchase(uuid, text, text, integer, integer, text) to service_role;
