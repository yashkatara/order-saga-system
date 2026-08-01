-- payment_db: owned by the Payment service.
CREATE DATABASE IF NOT EXISTS payment_db;
USE payment_db;

CREATE TABLE IF NOT EXISTS charges (
  order_id    VARCHAR(64) PRIMARY KEY,
  amount      DECIMAL(12,2) NOT NULL,
  status      ENUM('CHARGED','REFUNDED') NOT NULL DEFAULT 'CHARGED',
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
