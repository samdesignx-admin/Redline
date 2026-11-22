-- REVIEW ONLY: DO NOT APPLY TO PRODUCTION WITHOUT EXPLICIT APPROVAL.
-- Separate atomic, deletion-safe ledger for free beta (3 audits/account/UTC month).
create table if not exists public.free_beta_audit_usage (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  month_start date not null,
  request_id uuid not null,
  audit_id uuid references public.audits(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (account_id, request_id),
  constraint free_beta_month_first_day check (extract(day from month_start) = 1)
);
create index if not exists free_beta_usage_account_month
  on public.free_beta_audit_usage(account_id, month_start);
alter table public.free_beta_audit_usage enable row level security;
revoke all on public.free_beta_audit_usage from public, anon, authenticated;
grant select, insert on public.free_beta_audit_usage to service_role;

-- Called ONLY by the server with a verified application session, via service_role.
-- Account row lock serializes concurrent requests for the same account.
create or replace function public.create_free_beta_audit(
  p_account_id uuid, p_request_id uuid, p_audit jsonb
) returns jsonb
language plpgsql security invoker set search_path = ''
as $function$
declare
  v_account public.accounts%rowtype;
  v_audit public.audits%rowtype;
  v_month date := date_trunc('month', now() at time zone 'UTC')::date;
  v_used integer;
  v_existing public.free_beta_audit_usage%rowtype;
begin
  if p_account_id is null or p_request_id is null or p_audit is null
     or jsonb_typeof(p_audit) <> 'object' then
    raise exception 'INVALID_BETA_AUDIT_REQUEST';
  end if;

  select * into v_account from public.accounts where id = p_account_id for update;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;

  select * into v_existing from public.free_beta_audit_usage
    where account_id = p_account_id and request_id = p_request_id;
  if found then
    select * into v_audit from public.audits
      where id = v_existing.audit_id and account_id = p_account_id;
    if not found then raise exception 'BETA_REQUEST_ALREADY_CONSUMED'; end if;
    select count(*) into v_used from public.free_beta_audit_usage
      where account_id = p_account_id and month_start = v_month;
    return jsonb_build_object('audit', to_jsonb(v_audit),
      'used', v_used, 'paid', 0, 'remaining', greatest(3-v_used,0),
      'duplicate', true);
  end if;

  select count(*) into v_used from public.free_beta_audit_usage
    where account_id = p_account_id and month_start = v_month;
  if v_used >= 3 then raise exception 'BETA_MONTHLY_QUOTA_EXCEEDED'; end if;

  insert into public.audits(account_id,title,mode,url,screen_count,score,
    assessment,scorecard,severities,pages,raw_text)
  values(p_account_id,
    left(nullif(p_audit->>'title',''),500),
    left(coalesce(nullif(p_audit->>'mode',''),'files'),50),
    left(nullif(p_audit->>'url',''),2000),
    greatest(0,least(250,coalesce((p_audit->>'screenCount')::integer,0))),
    (p_audit->>'score')::integer,
    left(nullif(p_audit->>'assessment',''),2000),
    p_audit->'scorecard',p_audit->'severities',p_audit->'pages',
    left(coalesce(p_audit->>'rawText',''),60000))
  returning * into v_audit;

  insert into public.free_beta_audit_usage(account_id,month_start,request_id,audit_id)
  values(p_account_id,v_month,p_request_id,v_audit.id);

  return jsonb_build_object('audit',to_jsonb(v_audit),
    'used',v_used+1,'paid',0,'remaining',greatest(2-v_used,0),
    'duplicate',false);
end;
$function$;
revoke execute on function public.create_free_beta_audit(uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_free_beta_audit(uuid,uuid,jsonb) to service_role;

-- Verification in a NON-PRODUCTION clone:
-- 1) 3 distinct request IDs succeed; 4th fails.
-- 2) Concurrent requests cannot exceed 3.
-- 3) Same request ID returns duplicate result; deleting an audit does not restore quota.
-- 4) Month boundary resets at 00:00 UTC.
-- 5) anon/authenticated cannot execute function or access usage table.
