-- notification_db: owned by the Notification service.
CREATE DATABASE IF NOT EXISTS notification_db;
USE notification_db;

-- This service does NOT talk to the coordinator's DB directly (each service
-- owns its own data). Instead it polls the coordinator's public API for
-- orders with status = SHIPPED, then records a notification here.
-- The UNIQUE key on order_id + the "claim with UPDATE...WHERE sent_at IS NULL"
-- pattern is what gives "exactly one notification per order" even with the
-- cron job re-running every 15 min and multiple service instances running.
CREATE TABLE IF NOT EXISTS notifications (
  order_id    VARCHAR(64) PRIMARY KEY,
  sent_at     DATETIME(3) NULL,
  attempts    INT NOT NULL DEFAULT 0,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
