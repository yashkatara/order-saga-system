// Integration tests -- run against the full docker-compose stack (MySQL +
// the four leaf services + coordinator all up), because the saga engine's
// job is specifically to coordinate real network calls to real services.
//
//   docker compose up -d
//   cd services/coordinator && npm test
//
// Uses Node's built-in test runner (node --test), no extra dependency needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db');
const { processOrder } = require('../src/saga');

function uniqueId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function insertOrder({ orderId, sku = 'WIDGET-A', qty = 1, amount = 10, failAt = null, compFailAt = null }) {
  await pool.query(
    `INSERT INTO orders (order_id, sku, qty, amount, fail_at, comp_fail_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS')`,
    [orderId, sku, qty, amount, failAt, compFailAt]
  );
  const [[order]] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [orderId]);
  return order;
}

test('all four steps succeed -> order ends up PLACED', async () => {
  const orderId = uniqueId('ORD-OK');
  const order = await insertOrder({ orderId, qty: 1, amount: 5 });

  const finalStatus = await processOrder(order);
  assert.equal(finalStatus, 'PLACED');

  const [steps] = await pool.query(
    `SELECT step_name, status FROM saga_steps WHERE order_id = ? AND action = 'DO'`,
    [orderId]
  );
  assert.equal(steps.length, 4);
  assert.ok(steps.every((s) => s.status === 'SUCCESS'));
});

test('a step fails -> everything already done is undone -> order ends up CANCELLED', async () => {
  const orderId = uniqueId('ORD-FAIL');
  // fail_at = PAYMENT means the order + stock steps succeed, then payment
  // fails, so order+stock must both be compensated.
  const order = await insertOrder({ orderId, qty: 1, amount: 5, failAt: 'PAYMENT' });

  const finalStatus = await processOrder(order);
  assert.equal(finalStatus, 'CANCELLED');

  const [undoSteps] = await pool.query(
    `SELECT step_name, status FROM saga_steps WHERE order_id = ? AND action = 'UNDO'`,
    [orderId]
  );
  const undone = new Set(undoSteps.filter((s) => s.status === 'SUCCESS').map((s) => s.step_name));
  assert.ok(undone.has('ORDER'));
  assert.ok(undone.has('STOCK'));
  // shipping never ran (it's after payment in do-order attempt), so it must
  // never appear as an UNDO -- nothing done twice, nothing undone that never ran.
  assert.ok(!undone.has('SHIPPING'));
});

test('processing the same order twice never re-applies an effect (idempotency)', async () => {
  const orderId = uniqueId('ORD-IDEMP');
  const order = await insertOrder({ orderId, sku: 'WIDGET-B', qty: 2, amount: 20 });

  await processOrder(order);
  const [[afterFirst]] = await pool.query(
    'SELECT available_qty FROM inventory_db.stock WHERE sku = ?',
    ['WIDGET-B']
  );

  // Re-run the exact same order (simulates a retried/duplicated worker pickup
  // after a crash) -- every step should be skipped as already-SUCCESS.
  await processOrder(order);
  const [[afterSecond]] = await pool.query(
    'SELECT available_qty FROM inventory_db.stock WHERE sku = ?',
    ['WIDGET-B']
  );

  assert.equal(afterFirst.available_qty, afterSecond.available_qty);

  const [doSteps] = await pool.query(
    `SELECT step_name, attempt_count FROM saga_steps WHERE order_id = ? AND action = 'DO'`,
    [orderId]
  );
  // attempt_count only increments on rows that actually re-ran; since the
  // second processOrder() call short-circuits on SUCCESS, no row should have
  // been touched a second time.
  assert.ok(doSteps.every((s) => s.attempt_count === 1));
});
