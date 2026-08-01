const express = require('express');
const { createPool, withIdempotency } = require('./common');

const app = express();
app.use(express.json());
const pool = createPool();
const handle = withIdempotency(pool, { stepName: 'STOCK' });

app.get('/health', (req, res) => res.json({ ok: true, service: 'inventory-service' }));

// DO: set aside (reserve) the items
app.post('/orders/:orderId/reserve', (req, res) =>
  handle(req, res, async (conn, body) => {
    const { orderId } = req.params;
    const { sku, qty } = body;

    await conn.beginTransaction();
    try {
      const [[row]] = await conn.query(
        'SELECT available_qty FROM stock WHERE sku = ? FOR UPDATE',
        [sku]
      );
      if (!row || row.available_qty < qty) {
        await conn.rollback();
        throw new Error(`Insufficient stock for ${sku}: have ${row ? row.available_qty : 0}, need ${qty}`);
      }
      await conn.query(
        'UPDATE stock SET available_qty = available_qty - ?, reserved_qty = reserved_qty + ? WHERE sku = ?',
        [qty, qty, sku]
      );
      await conn.query(
        `INSERT INTO reservations (order_id, sku, qty, status) VALUES (?, ?, ?, 'RESERVED')
         ON DUPLICATE KEY UPDATE status = status`,
        [orderId, sku, qty]
      );
      await conn.commit();
    } catch (err) {
      // beginTransaction/rollback already handled above for the stock-check path;
      // for any other error make sure we don't leave the connection mid-transaction.
      try { await conn.rollback(); } catch (_) {}
      throw err;
    }
    return { orderId, sku, qty, status: 'RESERVED' };
  })
);

// UNDO: put the items back
app.post('/orders/:orderId/release', (req, res) =>
  handle(req, res, async (conn, body) => {
    const { orderId } = req.params;
    const [[resv]] = await conn.query('SELECT * FROM reservations WHERE order_id = ?', [orderId]);
    if (!resv || resv.status === 'RELEASED') {
      return { orderId, status: 'RELEASED' }; // nothing to do / already released
    }
    await conn.query(
      'UPDATE stock SET available_qty = available_qty + ?, reserved_qty = reserved_qty - ? WHERE sku = ?',
      [resv.qty, resv.qty, resv.sku]
    );
    await conn.query(`UPDATE reservations SET status = 'RELEASED' WHERE order_id = ?`, [orderId]);
    return { orderId, status: 'RELEASED' };
  })
);

const PORT = process.env.PORT || 4002;
app.listen(PORT, () => console.log(`inventory-service listening on ${PORT}`));
