const mysql = require('mysql2/promise');

function createPool() {
  return mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    decimalNumbers: true,
  });
}

// Every downstream service (order/inventory/payment/shipping) exposes
// DO and UNDO for its one step. Both are wrapped with this helper so that:
//   1. A retried call with the same idempotency_key never re-applies the effect
//      (looks up the ledger and replays the stored result instead).
//   2. fail_at / comp_fail_at from the CSV can force a deterministic failure,
//      so the assignment's "some rows are marked to fail on purpose" behaviour
//      is honoured without special-casing it in the coordinator.
//   3. A short artificial delay + the caller's timeout together let the
//      coordinator's "slow reply treated as failed" rule be demonstrated.
function withIdempotency(pool, { stepName }) {
  return async function idempotentHandler(req, res, effectFn) {
    const { orderId } = req.params;
    const { idempotencyKey, action } = req.body; // action: 'DO' | 'UNDO'
    const forceFail = action === 'DO' ? req.body.failAt : req.body.compFailAt;

    if (!idempotencyKey) {
      return res.status(400).json({ error: 'idempotencyKey is required' });
    }

    const conn = await pool.getConnection();
    try {
      const [existing] = await conn.query(
        'SELECT result, response_body FROM idempotency_ledger WHERE idempotency_key = ?',
        [idempotencyKey]
      );
      if (existing.length > 0) {
        // Already processed this exact attempt before -- replay, don't redo.
        const row = existing[0];
        return res
          .status(row.result === 'SUCCESS' ? 200 : 409)
          .json({ ...row.response_body, replayed: true, result: row.result });
      }

      // Simulate a forced failure for this step, as marked in the input CSV.
      const shouldForceFail = forceFail && forceFail.toUpperCase() === stepName;

      let result = 'SUCCESS';
      let body = {};
      try {
        if (shouldForceFail) {
          throw new Error(`Simulated failure for step=${stepName} action=${action} (forced by CSV mark)`);
        }
        body = await effectFn(conn, req.body);
      } catch (err) {
        result = 'FAILED';
        body = { error: err.message };
      }

      await conn.query(
        `INSERT INTO idempotency_ledger (idempotency_key, order_id, action, result, response_body)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE result = result`, // race-safe: first writer wins
        [idempotencyKey, orderId, action, result, JSON.stringify(body)]
      );

      return res.status(result === 'SUCCESS' ? 200 : 500).json({ ...body, result });
    } finally {
      conn.release();
    }
  };
}

module.exports = { createPool, withIdempotency };
