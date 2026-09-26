alter table audit_purchases
  add column if not exists creem_checkout_id text,
  add column if not exists creem_event_id text,
  add column if not exists payment_provider text,
  add column if not exists currency text;

create unique index if not exists audit_purchases_creem_checkout_uidx on audit_purchases (creem_checkout_id) where creem_checkout_id is not null;
create unique index if not exists audit_purchases_creem_event_uidx on audit_purchases (creem_event_id) where creem_event_id is not null;

create or replace function increment_paid_audits(p_account_id uuid, p_amount integer)
returns void language sql security definer set search_path = public
as $$ update accounts set paid_audits = greatest(0, coalesce(paid_audits, 0) + p_amount) where id = p_account_id; $$;
grant execute on function increment_paid_audits(uuid, integer) to service_role;
