-- DESIGN DRAFT ONLY — NOT APPLIED. Requires security review and explicit approval.
-- Atomic single-use password reset: one RPC transaction claims the token and
-- updates the account. The server validates the HMAC/code/expiry and hashes
-- the new password BEFORE invoking this function.
-- Never expose this RPC to anon/authenticated roles.
create table if not exists public.password_reset_consumptions (
  token_digest text primary key check (token_digest ~ '^[0-9a-f]{64}$'),
  account_id uuid not null references public.accounts(id) on delete cascade,
  consumed_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists password_reset_consumptions_expires_idx
  on public.password_reset_consumptions(expires_at);
alter table public.password_reset_consumptions enable row level security;
revoke all on public.password_reset_consumptions from public, anon, authenticated;

-- SECURITY DEFINER is deliberately avoided. The server's service-role
-- connection must own permissions to execute this transaction function.
create or replace function public.consume_password_reset(
  p_account_id uuid, p_token_digest text, p_expires_at timestamptz,
  p_password_hash text
) returns boolean
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_token_digest !~ '^[0-9a-f]{64}$'
     or p_expires_at <= now()
     or p_expires_at > now() + interval '10 minutes'
     or p_password_hash is null or length(p_password_hash) = 0 then
    return false;
  end if;
  insert into public.password_reset_consumptions
    (token_digest, account_id, expires_at)
  values (p_token_digest, p_account_id, p_expires_at)
  on conflict (token_digest) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then return false; end if;

  update public.accounts
  set password_hash = p_password_hash
  where id = p_account_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Account not found; rollback token claim';
  end if;
  return true;
end;
$$;
revoke all on function public.consume_password_reset(uuid,text,timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.consume_password_reset(uuid,text,timestamptz,text)
  to service_role;

-- Integration requirements:
-- 1. Check accounts.id type is uuid before applying; adjust if not.
-- 2. Server computes SHA-256 digest of full signed reset token plus email
--    (never store raw code/token), validates purpose/expiry/HMAC first.
-- 3. Server calls RPC once; success iff boolean true. Do not fall back
--    to direct accounts.update. Ensure error handling fails closed.
-- 4. Concurrent same-token requests: exactly one succeeds.
-- 5. Test invalid/expired/wrong-email tokens, absent account, and rollback.
-- 6. Retention cleanup of expired digest rows can be scheduled separately.
-- 7. Review grants and function execution privileges in a disposable DB.
