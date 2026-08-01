-- order_db: owned by the Order service.
CREATE DATABASE IF NOT EXISTS order_db;
USE order_db;

-- The service's own view of "orders it created". Kept separate from the
-- coordinator's orders table on purpose -- each service owns its own data.
CREATE TABLE IF NOT EXISTS orders (
  order_id    VARCHAR(64) PRIMARY KEY,
  sku         VARCHAR(64) NOT NULL,
  qty         INT NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  status      ENUM('CREATED','CANCELLED') NOT NULL DEFAULT 'CREATED',
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

-- Idempotency ledger: every DO/UNDO call the coordinator makes carries an
-- idempotency_key. The UNIQUE constraint means a retried/duplicated call
-- (network retry, redelivery, coordinator restart) can never apply the
-- effect twice -- we just look up and return the stored result.
CREATE TABLE IF NOT EXISTS idempotency_ledger (
  idempotency_key VARCHAR(128) PRIMARY KEY,
  order_id        VARCHAR(64) NOT NULL,
  action          ENUM('DO','UNDO') NOT NULL,
  result          ENUM('SUCCESS','FAILED') NOT NULL,
  response_body   JSON NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_order (order_id)
) ENGINE=InnoDB;
