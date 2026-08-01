const os = require('os');
const crypto = require('crypto');
const pool = require('./db');
const { processOrder } = require('./saga');

const WORKER_ID = `${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
const BATCH_SIZE = Number(process.env.CLAIM_BATCH_SIZE || 50);
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY || 20);
const LEASE_MS = Number(process.env.LEASE_MS || 30000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 1000);

// Claims a batch of work: orders that are freshly QUEUED, OR orders that were
// IN_PROGRESS but whose lease has expired (previous owner crashed/restarted --
// this is the restart-recovery path). FOR UPDATE SKIP LOCKED means multiple
// coordinator instances polling at once never grab the same row.
async function claimBatch() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT order_id FROM orders
       WHERE status = 'QUEUED' OR (status = 'IN_PROGRESS' AND lease_until < NOW(3))
       ORDER BY created_at
       LIMIT ?
       FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE]
    );
    if (rows.length === 0) {
      await conn.commit();
      return [];
    }
    const ids = rows.map((r) => r.order_id);
    await conn.query(
      `UPDATE orders SET status = 'IN_PROGRESS', locked_by = ?, lease_until = DATE_ADD(NOW(3), INTERVAL ? MICROSECOND)
       WHERE order_id IN (${ids.map(() => '?').join(',')})`,
      [WORKER_ID, LEASE_MS * 1000, ...ids]
    );
    await conn.commit();

    const [fullRows] = await conn.query(
      `SELECT * FROM orders WHERE order_id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    return fullRows;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Simple bounded-concurrency runner so we don't fire thousands of orders'
// worth of HTTP calls at once, even though the whole batch is "at the same time".
async function runWithConcurrency(items, limit, fn) {
  const results = [];
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]).catch((err) => ({ error: err.message }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

let running = false;

async function pollOnce() {
  const batch = await claimBatch();
  if (batch.length === 0) return 0;
  console.log(`[worker ${WORKER_ID}] claimed ${batch.length} order(s)`);
  await runWithConcurrency(batch, CONCURRENCY, (order) => processOrder(order));
  return batch.length;
}

function start() {
  if (running) return;
  running = true;
  console.log(`[worker ${WORKER_ID}] starting poll loop (every ${POLL_INTERVAL_MS}ms)`);
  const tick = async () => {
    try {
      await pollOnce();
    } catch (err) {
      console.error('[worker] poll error:', err.message);
    } finally {
      if (running) setTimeout(tick, POLL_INTERVAL_MS);
    }
  };
  tick();
}

function stop() {
  running = false;
}

module.exports = { start, stop, pollOnce, WORKER_ID };
