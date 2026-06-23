-- name: createTables
CREATE TABLE IF NOT EXISTS Outbox (
  id         TEXT PRIMARY KEY NOT NULL,
  createdAt  TEXT NOT NULL,
  updatedAt  TEXT NOT NULL,
  eventName  TEXT NOT NULL,
  eventId    TEXT NOT NULL UNIQUE,
  publishedBy TEXT NOT NULL,
  publishedAt TEXT NOT NULL,
  processedBy TEXT,
  processedAt TEXT,
  payload    TEXT NOT NULL,
  data       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'PENDING'
               CHECK (status IN ('PENDING','PROCESSING','COMPLETED','DEAD')),
  retries    INTEGER NOT NULL DEFAULT 0,
  error      TEXT
);

CREATE INDEX IF NOT EXISTS status_created_at_idx
  ON Outbox(status, createdAt);

CREATE INDEX IF NOT EXISTS published_by_status_created_at_idx
  ON Outbox(publishedBy, status, createdAt);

-- name: insert
INSERT INTO Outbox (
  id, createdAt, updatedAt,
  eventName, eventId,
  publishedBy, publishedAt,
  payload, data
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: selectRetries
SELECT retries FROM Outbox WHERE eventId = ?;

-- name: selectOngoing
SELECT *
FROM Outbox
WHERE publishedBy = ?
  AND status NOT IN ('COMPLETED', 'DEAD');

-- name: selectPendingRetries
SELECT retries FROM Outbox WHERE eventId = ? AND status = 'PENDING';

-- name: updateProcessing
UPDATE Outbox
SET status = 'PROCESSING', updatedAt = ?
WHERE eventId = ?;

-- name: updateCompleted
UPDATE Outbox
SET status = 'COMPLETED', updatedAt = ?
WHERE eventId = ?;

-- name: incrementRetry
UPDATE Outbox
SET retries = retries + 1, updatedAt = ?
WHERE eventId = ?;

-- name: decrementRetry
UPDATE Outbox
SET retries = retries - 1, updatedAt = ?
WHERE eventId = ? AND retries > 0;

-- name: updateDead
UPDATE Outbox
SET status = 'DEAD', error = ?, updatedAt = ?
WHERE eventId = ?;

-- name: selectDeadOutboxes
SELECT *
FROM Outbox
WHERE publishedBy = ?
  AND retries >= ?
  AND status != 'DEAD';

-- name: deleteDeadOutboxes
DELETE FROM Outbox
WHERE publishedBy = ?
  AND retries >= ?;
