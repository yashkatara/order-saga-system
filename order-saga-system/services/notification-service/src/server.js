const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'notification_db',
  waitForConnections: true,
  connectionLimit: 10,
});

const COORDINATOR_URL = process.env.COORDINATOR_URL || 'http://localhost:4000';
const JOB_INTERVAL_MS = Number(process.env.JOB_INTERVAL_MS || 15 * 60 * 1000); // every 15 minutes

// This service does NOT share a database with the coordinator (services own
// their own data) -- it discovers Shipped orders through the coordinator's
// public API, then does its own exactly-once bookkeeping locally.
async function fetchAllShippedOrderIds() {
  const ids = [];
  let page = 1;
  const pageSize = 200;
  while (true) {
    const res = await fetch(`${COORDINATOR_URL}/api/orders?status=SHIPPED&page=${page}&pageSize=${pageSize}`);
    const data = await res.json();
    ids.push(...data.items.map((o) => o.order_id));
    if (page * pageSize >= data.total) break;
    page++;
  }
  return ids;
}

// The exactly-once guarantee:
//   1. INSERT IGNORE registers the order the first time we ever see it
//      shipped -- harmless no-op on every later run.
//   2. UPDATE ... WHERE sent_at IS NULL is an atomic, row-locking claim.
//      If two instances of this service (or two overlapping cron firings)
//      race on the same order, only one UPDATE actually matches a row
//      (affectedRows = 1); the other gets 0 and does nothing further.
// So each shipped order is notified exactly once, no matter how many times
// the job runs or how many copies of the service are running.
async function runJob() {
  const shippedIds = await fetchAllShippedOrderIds();
  if (shippedIds.length === 0) {
    console.log('[notification-job] no shipped orders found');
    return { processed: 0, sent: 0 };
  }

  let sent = 0;
  for (const orderId of shippedIds) {
    await pool.query(
      `INSERT IGNORE INTO notifications (order_id, attempts) VALUES (?, 0)`,
      [orderId]
    );
    const [result] = await pool.query(
      `UPDATE notifications SET sent_at = NOW(3), attempts = attempts + 1
       WHERE order_id = ? AND sent_at IS NULL`,
      [orderId]
    );
    if (result.affectedRows === 1) {
      sent++;
      // "sending a notification" == recording that one was sent, per the assignment
      console.log(`[notification-job] sent shipping notification for order ${orderId}`);
    }
  }
  console.log(`[notification-job] processed ${shippedIds.length} shipped order(s), sent ${sent} new notification(s)`);
  return { processed: shippedIds.length, sent };
}

app.get('/health', (req, res) => res.json({ ok: true, service: 'notification-service' }));

// Exposed so the run can also be triggered manually / inspected in the demo.
app.post('/run-now', async (req, res) => {
  try {
    const result = await runJob();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4005;
app.listen(PORT, () => {
  console.log(`notification-service listening on ${PORT}`);
  runJob().catch((err) => console.error('[notification-job] initial run failed:', err.message));
  setInterval(() => {
    runJob().catch((err) => console.error('[notification-job] failed:', err.message));
  }, JOB_INTERVAL_MS);
});
