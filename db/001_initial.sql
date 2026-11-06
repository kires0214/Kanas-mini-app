CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS football_fields (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 80),
  description text NOT NULL DEFAULT '',
  price_kzt integer NOT NULL CHECK (price_kzt > 0),
  opens_at time NOT NULL DEFAULT '07:00',
  closes_at time NOT NULL DEFAULT '23:00',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_field_hours CHECK (opens_at < closes_at)
);

CREATE TABLE IF NOT EXISTS customers (
  telegram_id bigint PRIMARY KEY,
  first_name text NOT NULL,
  username text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id bigint NOT NULL REFERENCES football_fields(id),
  telegram_id bigint NOT NULL REFERENCES customers(telegram_id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  price_kzt integer NOT NULL CHECK (price_kzt > 0),
  status text NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'review', 'confirmed', 'rejected', 'expired')),
  hold_expires_at timestamptz NOT NULL,
  customer_marked_paid_at timestamptz,
  decided_at timestamptz,
  decided_by bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at = starts_at + interval '1 hour')
);

DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='bookings'::regclass AND conname='unique_active_field_interval') THEN
ALTER TABLE bookings
  ADD CONSTRAINT unique_active_field_interval
  EXCLUDE USING gist (
    field_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('held', 'review', 'confirmed'));
END IF;
END $$;

CREATE INDEX IF NOT EXISTS bookings_customer_idx ON bookings (telegram_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS bookings_field_start_idx ON bookings (field_id, starts_at);
CREATE INDEX IF NOT EXISTS bookings_hold_expiration_idx ON bookings (hold_expires_at) WHERE status = 'held';
