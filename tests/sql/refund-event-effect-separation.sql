-- Disposable PostgreSQL fixture only; never run against production.
BEGIN;
CREATE TEMP TABLE refund_events (
  event_id text PRIMARY KEY,
  refund_id text NOT NULL,
  state text NOT NULL
);
CREATE TEMP TABLE refund_effects (
  provider text NOT NULL,
  refund_id text NOT NULL,
  reversed_credits integer NOT NULL CHECK (reversed_credits > 0),
  PRIMARY KEY (provider, refund_id)
);
INSERT INTO refund_events VALUES
 ('evt_received','refund_1','received'),
 ('evt_applied','refund_1','applied');
INSERT INTO refund_effects VALUES ('creem','refund_1',1);
-- A distinct lifecycle event is preserved without duplicating the financial effect.
INSERT INTO refund_effects VALUES ('creem','refund_1',1)
ON CONFLICT (provider,refund_id) DO NOTHING;
DO $$
BEGIN
 IF (SELECT count(*) FROM refund_events WHERE refund_id='refund_1') <> 2 THEN
   RAISE EXCEPTION 'Legitimate lifecycle events were lost';
 END IF;
 IF (SELECT count(*) FROM refund_effects WHERE refund_id='refund_1') <> 1 THEN
   RAISE EXCEPTION 'Duplicate financial effect';
 END IF;
END $$;
-- Confirm uniqueness actually rejects an unconditional duplicate effect.
DO $$
BEGIN
 BEGIN
   INSERT INTO refund_effects VALUES ('creem','refund_1',1);
   RAISE EXCEPTION 'Duplicate effect unexpectedly allowed';
 EXCEPTION WHEN unique_violation THEN
   NULL;
 END;
END $$;
ROLLBACK;
