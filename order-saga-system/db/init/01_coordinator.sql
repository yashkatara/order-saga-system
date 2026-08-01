-- coordinator_db: owned by the Coordinator service.
-- This is the saga "brain" store: one row per order, one row per saga step attempt.
CREATE DATABASE IF NOT EXISTS coordinator_db;
USE coordinator_db;

CREATE TABLE IF NOT EXISTS orders (
  order_id        VARCHAR(64) PRIMARY KEY,
  sku             VARCHAR(64) NOT NULL,
  qty             INT NOT NULL,
  amount          DECIMAL(12,2) NOT NULL,
  fail_at         VARCHAR(32) NULL,      -- which "do" step should be forced to fail (from CSV)
  comp_fail_at    VARCHAR(32) NULL,      -- which "undo" step should be forced to fail (from CSV)

  -- QUEUED: loaded, not yet claimed by a worker
  -- IN_PROGRESS: a worker owns it and is running the saga
  -- PLACED: all 4 steps succeeded
  -- CANCELLED: a step failed and all completed steps were successfully undone
  -- NEEDS_ATTENTION: an undo (compensation) kept failing and needs manual retry
  -- SHIPPED: user marked a Placed order as shipped
  status          ENUM('QUEUED','IN_PROGRESS','PLACED','CANCELLED','NEEDS_ATTENTION','SHIPPED')
                  NOT NULL DEFAULT 'QUEUED',

  -- leasing so multiple coordinator instances can claim work without colliding
  locked_by       VARCHAR(64) NULL,
  lease_until     DATETIME(3) NULL,

  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  INDEX idx_status (status),
  INDEX idx_lease (status, lease_until)
) ENGINE=InnoDB;

-- One row per (step, action) attempted for an order. This is both the audit trail
-- ("keep a clear record") and the idempotency ledger ("never do a step twice") --
-- the UNIQUE key on idempotency_key means a retried call is always deduped here.
CREATE TABLE IF NOT EXISTS saga_steps (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_id         VARCHAR(64) NOT NULL,
  step_name        ENUM('ORDER','STOCK','PAYMENT','SHIPPING') NOT NULL,
  action           ENUM('DO','UNDO') NOT NULL,
  idempotency_key  VARCHAR(128) NOT NULL,

  status           ENUM('PENDING','IN_PROGRESS','SUCCESS','FAILED') NOT NULL DEFAULT 'PENDING',
  attempt_count    INT NOT NULL DEFAULT 0,
  last_error       TEXT NULL,

  started_at       DATETIME(3) NULL,
  finished_at      DATETIME(3) NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE KEY uq_idempotency (idempotency_key),
  INDEX idx_order (order_id),
  CONSTRAINT fk_saga_order FOREIGN KEY (order_id) REFERENCES orders(order_id)
) ENGINE=InnoDB;

-- Dedup guard for the bulk CSV loader: re-loading the same file must not create
-- duplicate orders. order_id is already the PK on `orders`, but this table lets
-- the loader do a fast idempotent "have I already ingested this file line" check
-- and record load runs for audit purposes.
CREATE TABLE IF NOT EXISTS ingested_orders (
  order_id    VARCHAR(64) PRIMARY KEY,
  source_file VARCHAR(255) NULL,
  loaded_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
