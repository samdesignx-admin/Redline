-- UXNest Creem payment migration
alter table audit_purchases
  add column if not exists creem_checkout_id text,
  add column if not exists creem_event_id text,
  add column if not exists payment_provider text,
  add column if not exists currency text;

create unique index if not exists audit_purchases_creem_checkout_uidx
  on audit_purchases (creem_checkout_id) where creem_checkout_id is not null;
create unique index if not exists audit_purchases_creem_event_uidx
  on audit_purchases (creem_event_id) where creem_event_id is not null;

create or replace function increment_paid_audits(p_account_id uuid, p_amount integer)
returns void language sql security definer set search_path = public
as $$ update accounts set paid_audits = greatest(0, coalesce(paid_audits, 0) + p_amount) where id = p_account_id; $$;
grant execute on function increment_paid_audits(uuid, integer) to service_role;

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

grant execute on function grant_creem_audit_purchase(uuid, text, text, integer, integer, text) to service_role;
