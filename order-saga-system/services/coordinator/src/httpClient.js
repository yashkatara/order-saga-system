// A step call has a hard time limit -- a slow reply is treated as a failure --
// and is retried a bounded number of times with a short backoff before the
// saga gives up on that step for this attempt round.
const STEP_TIMEOUT_MS = Number(process.env.STEP_TIMEOUT_MS || 3000);
const MAX_RETRIES = Number(process.env.STEP_MAX_RETRIES || 3);
const RETRY_DELAY_MS = Number(process.env.STEP_RETRY_DELAY_MS || 300);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callWithTimeout(url, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.result === 'FAILED') {
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// Retries the same idempotency_key on failure/timeout. Because the downstream
// service dedupes on that key, retrying is always safe -- it never re-applies
// the effect, it just re-asks "did this happen yet?".
async function callStepWithRetry(url, body, { maxRetries = MAX_RETRIES, timeoutMs = STEP_TIMEOUT_MS } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await callWithTimeout(url, body, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw lastErr;
}

module.exports = { callStepWithRetry, sleep };
