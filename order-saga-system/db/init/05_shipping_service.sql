-- shipping_db: owned by the Shipping service.
CREATE DATABASE IF NOT EXISTS shipping_db;
USE shipping_db;

CREATE TABLE IF NOT EXISTS shipments (
  order_id    VARCHAR(64) PRIMARY KEY,
  status      ENUM('ARRANGED','CANCELLED') NOT NULL DEFAULT 'ARRANGED',
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS idempotency_ledger (
  idempotency_key VARCHAR(128) PRIMARY KEY,
  order_id        VARCHAR(64) NOT NULL,
  action          ENUM('DO','UNDO') NOT NULL,
  result          ENUM('SUCCESS','FAILED') NOT NULL,
  response_body   JSON NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_order (order_id)
) ENGINE=InnoDB;
