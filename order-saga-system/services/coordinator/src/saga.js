const pool = require('./db');
const { STEPS } = require('./steps');
const { callStepWithRetry } = require('./httpClient');

const MAX_COMPENSATION_ROUNDS = Number(process.env.MAX_COMPENSATION_ROUNDS || 5);

function idemKey(orderId, stepName, action) {
  return `${orderId}:${stepName}:${action}`;
}

// Records the outcome of one step attempt in saga_steps. This table is both
// the audit trail the assignment asks for ("record what ran, when, whether
// it succeeded") and what lets a restarted coordinator know what's already
// been tried for an order it's resuming.
async function recordStep(orderId, stepName, action, status, extra = {}) {
  const key = idemKey(orderId, stepName, action);
  await pool.query(
    `INSERT INTO saga_steps (order_id, step_name, action, idempotency_key, status, attempt_count, last_error, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       attempt_count = attempt_count + 1,
       last_error = VALUES(last_error),
       finished_at = NOW(3)`,
    [orderId, stepName, action, key, status, extra.error || null]
  );
}

async function getStepStatus(orderId, stepName, action) {
  const [[row]] = await pool.query(
    `SELECT status FROM saga_steps WHERE idempotency_key = ?`,
    [idemKey(orderId, stepName, action)]
  );
  return row ? row.status : null;
}

// Runs one step's DO or UNDO. Idempotent at two levels:
//  1. If this coordinator already recorded SUCCESS for this exact step+action,
//     skip the network call entirely (covers coordinator restart mid-saga).
//  2. Otherwise the call still carries the same idempotency_key every time,
//     so even if we DID call before but crashed before recording it, the
//     downstream service's own ledger prevents a double effect.
async function runStep(order, step, action, forceFail) {
  const already = await getStepStatus(order.order_id, step.name, action);
  if (already === 'SUCCESS') return { name: step.name, ok: true, skipped: true };

  const url = action === 'DO' ? step.doUrl(order.order_id) : step.undoUrl(order.order_id);
  const key = idemKey(order.order_id, step.name, action);
  const body = {
    idempotencyKey: key,
    action,
    sku: order.sku,
    qty: order.qty,
    amount: order.amount,
    failAt: order.fail_at,
    compFailAt: order.comp_fail_at,
  };

  try {
    await callStepWithRetry(url, body);
    await recordStep(order.order_id, step.name, action, 'SUCCESS');
    return { name: step.name, ok: true };
  } catch (err) {
    await recordStep(order.order_id, step.name, action, 'FAILED', { error: err.message });
    return { name: step.name, ok: false, error: err.message };
  }
}

// Undo only the steps that actually finished (SUCCESS), in reverse order.
// Keeps trying (bounded rounds); if a step's undo still won't succeed the
// order is flagged NEEDS_ATTENTION instead of silently dropping it.
async function compensate(order, succeededSteps) {
  const toUndo = [...succeededSteps].reverse();
  let pending = toUndo;

  for (let round = 1; round <= MAX_COMPENSATION_ROUNDS && pending.length > 0; round++) {
    const results = await Promise.all(pending.map((step) => runStep(order, step, 'UNDO')));
    pending = pending.filter((step) => !results.find((r) => r.name === step.name && r.ok));
  }

  return pending.length === 0; // true = fully compensated
}

// Processes exactly one order end-to-end. Safe to call again for the same
// order at any point (crash/restart) -- already-successful steps are skipped,
// everything else is retried from where it stands.
async function processOrder(order) {
  const doResults = await Promise.all(STEPS.map((step) => runStep(order, step, 'DO')));
  const succeededSteps = STEPS.filter((s) => doResults.find((r) => r.name === s.name && r.ok));
  const allOk = doResults.every((r) => r.ok);

  if (allOk) {
    await setOrderStatus(order.order_id, 'PLACED');
    return 'PLACED';
  }

  const fullyCompensated = await compensate(order, succeededSteps);
  if (fullyCompensated) {
    await setOrderStatus(order.order_id, 'CANCELLED');
    return 'CANCELLED';
  } else {
    await setOrderStatus(order.order_id, 'NEEDS_ATTENTION');
    return 'NEEDS_ATTENTION';
  }
}

async function setOrderStatus(orderId, status) {
  await pool.query(
    `UPDATE orders SET status = ?, locked_by = NULL, lease_until = NULL WHERE order_id = ?`,
    [status, orderId]
  );
}

// Manual retry for an order stuck in NEEDS_ATTENTION: re-run compensation
// for whatever succeeded steps are still not undone.
async function retryCompensation(orderId) {
  const [[order]] = await pool.query('SELECT * FROM orders WHERE order_id = ?', [orderId]);
  if (!order) throw new Error('order not found');
  if (order.status !== 'NEEDS_ATTENTION') throw new Error('order is not in NEEDS_ATTENTION');

  const [steps] = await pool.query(
    `SELECT step_name FROM saga_steps WHERE order_id = ? AND action = 'DO' AND status = 'SUCCESS'`,
    [orderId]
  );
  const succeededStepNames = new Set(steps.map((s) => s.step_name));
  const succeededSteps = STEPS.filter((s) => succeededStepNames.has(s.name));

  const fullyCompensated = await compensate(order, succeededSteps);
  await setOrderStatus(orderId, fullyCompensated ? 'CANCELLED' : 'NEEDS_ATTENTION');
  return fullyCompensated ? 'CANCELLED' : 'NEEDS_ATTENTION';
}

module.exports = { processOrder, retryCompensation, setOrderStatus };
