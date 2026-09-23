-- UXNest database schema (Supabase / Postgres)
-- Run this in the Supabase SQL editor: Dashboard -> SQL Editor -> New query.

create table if not exists accounts (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  name          text,
  company       text,
  mobile        text,
  password_hash text,                       -- scrypt: salt:hash (null for Google sign-in)
  provider      text not null default 'password',
  email_verified boolean not null default false,
  audits_used   integer not null default 0,
  paid_audits   integer not null default 0,
  plan          text not null default 'free',
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists audits (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid references accounts(id) on delete cascade,
  title        text,
  mode         text,                        -- 'url' | 'files'
  url          text,
  screen_count integer default 0,
  score        integer,
  assessment   text,
  scorecard    jsonb,                       -- per-dimension scores
  severities   jsonb,                       -- {critical, high, medium, low}
  pages        jsonb,                       -- URLs explored during a URL audit
  raw_text     text,
  created_at   timestamptz not null default now()
);

create index if not exists audits_account_idx on audits(account_id);
create index if not exists audits_created_idx on audits(created_at desc);
create index if not exists accounts_created_idx on accounts(created_at desc);

-- All access goes through the serverless functions using the service role key,
-- so row level security stays on with no public policies. The anon key can
-- therefore never read this data directly from a browser.
alter table accounts enable row level security;
alter table audits   enable row level security;


-- One-time $5 audit purchases. Stripe Checkout session IDs are unique so
-- verifying the same payment twice cannot grant duplicate audit credits.
create table if not exists audit_purchases (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references accounts(id) on delete cascade,
  stripe_session_id  text unique not null,
  amount_cents       integer not null default 500,
  created_at         timestamptz not null default now()
);

create index if not exists audit_purchases_account_idx on audit_purchases(account_id);
alter table audit_purchases enable row level security;

-- Existing installations: run this once if the accounts table already exists.
alter table accounts add column if not exists paid_audits integer not null default 0;
