const express = require('express');
const { createPool, withIdempotency } = require('./common');

const app = express();
app.use(express.json());
const pool = createPool();
const handle = withIdempotency(pool, { stepName: 'PAYMENT' });

app.get('/health', (req, res) => res.json({ ok: true, service: 'payment-service' }));

// DO: charge the customer
app.post('/orders/:orderId/charge', (req, res) =>
  handle(req, res, async (conn, body) => {
    const { orderId } = req.params;
    await conn.query(
      `INSERT INTO charges (order_id, amount, status) VALUES (?, ?, 'CHARGED')
       ON DUPLICATE KEY UPDATE status = status`,
      [orderId, body.amount]
    );
    return { orderId, amount: body.amount, status: 'CHARGED' };
  })
);

// UNDO: refund the customer
app.post('/orders/:orderId/refund', (req, res) =>
  handle(req, res, async (conn, body) => {
    const { orderId } = req.params;
    const [[charge]] = await conn.query('SELECT * FROM charges WHERE order_id = ?', [orderId]);
    if (!charge || charge.status === 'REFUNDED') {
      return { orderId, status: 'REFUNDED' };
    }
    await conn.query(`UPDATE charges SET status = 'REFUNDED' WHERE order_id = ?`, [orderId]);
    return { orderId, status: 'REFUNDED' };
  })
);

const PORT = process.env.PORT || 4003;
app.listen(PORT, () => console.log(`payment-service listening on ${PORT}`));
