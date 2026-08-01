-- inventory_db: owned by the Inventory service.
CREATE DATABASE IF NOT EXISTS inventory_db;
USE inventory_db;

-- Seeded from sample_inventory.csv
CREATE TABLE IF NOT EXISTS stock (
  sku            VARCHAR(64) PRIMARY KEY,
  available_qty  INT NOT NULL,
  reserved_qty   INT NOT NULL DEFAULT 0,
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reservations (
  order_id    VARCHAR(64) PRIMARY KEY,
  sku         VARCHAR(64) NOT NULL,
  qty         INT NOT NULL,
  status      ENUM('RESERVED','RELEASED') NOT NULL DEFAULT 'RESERVED',
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
