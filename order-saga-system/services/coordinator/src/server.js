const path = require('path');
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const worker = require('./worker');
const { retryCompensation, setOrderStatus } = require('./saga');
const { loadOrdersCsv } = require('./loader');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true, service: 'coordinator', workerId: worker.WORKER_ID }));

// GET /api/orders?status=&page=&pageSize= -- paged list for the order list page
app.get('/api/orders', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Number(req.query.pageSize) || 20);
  const offset = (page - 1) * pageSize;
  const status = req.query.status;

  const where = status ? 'WHERE status = ?' : '';
  const params = status ? [status] : [];

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM orders ${where}`, params);
  const [rows] = await pool.query(
    `SELECT order_id, sku, qty, amount, status, created_at, updated_at
     FROM orders ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  res.json({ items: rows, total, page, pageSize });
});

// GET /api/orders/:id -- order detail with every saga step (do + undo) recorded
app.get('/api/orders/:id', async (req, res) => {
  const [[order]] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'not found' });

  const [steps] = await pool.query(
    `SELECT step_name, action, status, attempt_count, last_error, started_at, finished_at
     FROM saga_steps WHERE order_id = ? ORDER BY id ASC`,
    [req.params.id]
  );

  res.json({ order, steps });
});

// POST /api/orders/:id/retry-undo -- manual retry button for NEEDS_ATTENTION orders
app.post('/api/orders/:id/retry-undo', async (req, res) => {
  try {
    const status = await retryCompensation(req.params.id);
    res.json({ orderId: req.params.id, status });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/orders/:id/mark-shipped -- button on a Placed order
app.post('/api/orders/:id/mark-shipped', async (req, res) => {
  const [[order]] = await pool.query('SELECT status FROM orders WHERE order_id = ?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'not found' });
  if (order.status !== 'PLACED') {
    return res.status(400).json({ error: `order must be PLACED to ship, currently ${order.status}` });
  }
  await setOrderStatus(req.params.id, 'SHIPPED');
  res.json({ orderId: req.params.id, status: 'SHIPPED' });
});

// POST /api/admin/load-orders { path, sourceLabel } -- kicks off the streaming
// bulk loader. Re-POSTing the same file is safe (dedup on order_id).
app.post('/api/admin/load-orders', async (req, res) => {
  const filePath = req.body.path;
  if (!filePath) return res.status(400).json({ error: 'path is required' });
  try {
    const result = await loadOrdersCsv(path.resolve(filePath), { sourceLabel: req.body.sourceLabel });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`coordinator listening on ${PORT}`);
  worker.start(); // resumes any in-flight/queued orders -- this IS restart recovery
});
