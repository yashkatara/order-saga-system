const express = require('express');
const { createPool, withIdempotency } = require('./common');

const app = express();
app.use(express.json());
const pool = createPool();
const handle = withIdempotency(pool, { stepName: 'SHIPPING' });

app.get('/health', (req, res) => res.json({ ok: true, service: 'shipping-service' }));

// DO: arrange the shipment
app.post('/orders/:orderId/arrange', (req, res) =>
  handle(req, res, async (conn) => {
    const { orderId } = req.params;
    await conn.query(
      `INSERT INTO shipments (order_id, status) VALUES (?, 'ARRANGED')
       ON DUPLICATE KEY UPDATE status = status`,
      [orderId]
    );
    return { orderId, status: 'ARRANGED' };
  })
);

// UNDO: cancel the shipment
app.post('/orders/:orderId/cancel', (req, res) =>
  handle(req, res, async (conn) => {
    const { orderId } = req.params;
    await conn.query(`UPDATE shipments SET status = 'CANCELLED' WHERE order_id = ?`, [orderId]);
    return { orderId, status: 'CANCELLED' };
  })
);

const PORT = process.env.PORT || 4004;
app.listen(PORT, () => console.log(`shipping-service listening on ${PORT}`));
