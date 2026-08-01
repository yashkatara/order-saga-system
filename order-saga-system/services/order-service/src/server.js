const express = require('express');
const { createPool, withIdempotency } = require('./common');

const app = express();
app.use(express.json());
const pool = createPool();
const handle = withIdempotency(pool, { stepName: 'ORDER' });

app.get('/health', (req, res) => res.json({ ok: true, service: 'order-service' }));

// DO: create the order
app.post('/orders/:orderId/create', (req, res) =>
  handle(req, res, async (conn, body) => {
    const { orderId } = req.params;
    await conn.query(
      `INSERT INTO orders (order_id, sku, qty, amount, status)
       VALUES (?, ?, ?, ?, 'CREATED')
       ON DUPLICATE KEY UPDATE status = status`,
      [orderId, body.sku, body.qty, body.amount]
    );
    return { orderId, status: 'CREATED' };
  })
);

// UNDO: cancel the order
app.post('/orders/:orderId/cancel', (req, res) =>
  handle(req, res, async (conn, body) => {
    const { orderId } = req.params;
    await conn.query(`UPDATE orders SET status = 'CANCELLED' WHERE order_id = ?`, [orderId]);
    return { orderId, status: 'CANCELLED' };
  })
);

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => console.log(`order-service listening on ${PORT}`));
