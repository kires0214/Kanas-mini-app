ALTER TABLE bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('held','review','disputed','confirmed','rejected','expired'));
ALTER TABLE bookings DROP CONSTRAINT unique_active_field_interval;
ALTER TABLE bookings ADD CONSTRAINT unique_active_field_interval
  EXCLUDE USING gist (field_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status IN ('held','review','disputed','confirmed'));

ALTER TABLE bookings ADD COLUMN request_id uuid;
ALTER TABLE bookings ADD CONSTRAINT bookings_customer_request UNIQUE (telegram_id, request_id);
ALTER TABLE bookings ADD COLUMN decision_note text;
ALTER TABLE bookings ADD COLUMN payment_issue_open boolean NOT NULL DEFAULT false;
CREATE INDEX bookings_review_queue ON bookings (customer_marked_paid_at)
  WHERE status IN ('review','disputed') OR payment_issue_open;

CREATE TABLE booking_decisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id),
  telegram_id bigint NOT NULL,
  decision text NOT NULL CHECK (decision IN ('confirm','reject','dispute','resolve')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE telegram_notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_key text NOT NULL,
  chat_id bigint NOT NULL,
  message text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_key, chat_id)
);
CREATE INDEX telegram_notifications_due ON telegram_notifications (next_attempt_at)
  WHERE delivered_at IS NULL;
