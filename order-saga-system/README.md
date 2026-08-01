# Order Processing System

A saga-orchestrated order pipeline: Node.js/Express services, MySQL, Angular 17 frontend.

## Architecture

```
                     ┌─────────────────┐
   Angular  ───────▶ │   Coordinator    │  (the "brain" / saga orchestrator)
   frontend          │  coordinator_db  │
                     └───────┬──────────┘
                             │ calls DO/UNDO on each, at the same time,
                             │ with a per-call idempotency key
        ┌───────────┬────────┴────────┬───────────┐
        ▼           ▼                 ▼           ▼
   ┌─────────┐ ┌───────────┐   ┌───────────┐ ┌───────────┐
   │  Order  │ │ Inventory │   │  Payment  │ │ Shipping  │
   │ service │ │  service  │   │  service  │ │  service  │
   │order_db │ │inventory_db│  │payment_db │ │shipping_db│
   └─────────┘ └───────────┘   └───────────┘ └───────────┘

   ┌──────────────────────┐
   │  Notification service │  polls coordinator's API every 15 min for
   │   notification_db     │  SHIPPED orders, sends (records) exactly once
   └──────────────────────┘
```

Each service owns its own MySQL schema — no service reaches into another's tables.
The coordinator never talks to a downstream service's database; it only knows the
downstream service's HTTP contract (`POST .../<action>` with an `idempotencyKey`).

### How each requirement is met

| Requirement | How |
|---|---|
| All 4 steps attempted at the same time | `saga.js` calls `Promise.all` across the 4 step URLs |
| Failure → undo what succeeded, order → Cancelled | `compensate()` undoes only steps recorded `SUCCESS`, in reverse order |
| Retries with a wait, per-step timeout | `httpClient.js`: `AbortController` timeout + backoff retry loop |
| Never do a step twice | Two idempotency layers: (1) coordinator skips any step already recorded `SUCCESS` in `saga_steps`; (2) each downstream service has its own `idempotency_ledger` keyed on `idempotencyKey`, so even a duplicated HTTP call can't re-apply the effect |
| Survive a restart | Orders are claimed with a lease (`orders.lease_until`). `worker.js`'s poll loop picks up any order that's `QUEUED`, or `IN_PROGRESS` with an expired lease — that's restart recovery, no separate code path needed |
| Undo keeps failing → "Needs attention" + manual retry | `compensate()` gives up after `MAX_COMPENSATION_ROUNDS`, sets `NEEDS_ATTENTION`; the UI's Retry button calls `POST /api/orders/:id/retry-undo` → `retryCompensation()` |
| Clear audit record | `saga_steps` row per (step, action) attempt: status, attempt count, timestamps, last error |
| Bulk load without loading the whole file into memory | `loader.js` streams the CSV line-by-line with `readline` over a `fs.ReadStream`, inserting in batches |
| Re-loading the same file doesn't duplicate orders | `INSERT IGNORE` on `orders.order_id` (primary key) and `ingested_orders` |
| Many orders processed at once | `worker.js` claims a batch and runs it with bounded concurrency (`runWithConcurrency`), not one order at a time |
| Multiple coordinator instances, no double-processing | `SELECT ... FOR UPDATE SKIP LOCKED` when claiming a batch — two instances polling simultaneously can never claim the same order |
| Fast "was this step already done" lookup even at scale | `saga_steps.idempotency_key` and each service's `idempotency_ledger.idempotency_key` are indexed (`PRIMARY`/`UNIQUE`), so the check is a single indexed point lookup regardless of table size |
| Exactly one notification per shipped order | `notification-service`: `INSERT IGNORE` registers the order once, then an atomic `UPDATE notifications SET sent_at = NOW() WHERE order_id = ? AND sent_at IS NULL` — only one concurrent caller can ever win that update |

## Running it

Requires Docker + Docker Compose.

```bash
docker compose up -d --build
```

This starts MySQL (auto-creating all 6 schemas from `db/init/`), the four leaf
services, the coordinator, the notification service, and the Angular frontend.

- Frontend: http://localhost:4200
- Coordinator API: http://localhost:4000
- Leaf services: :4001 (order), :4002 (inventory), :4003 (payment), :4004 (shipping)
- Notification service: :4005

### Seed inventory

```bash
cd scripts
npm install
DB_HOST=localhost node seed-inventory.js ../data/sample_inventory.csv
```

### Bulk-load orders

Either via the CLI (streams the file, safe to re-run):

```bash
cd services/coordinator
npm install
node src/cli-load.js ../../data/orders_bulk.csv
```

...or via the API, if you'd rather trigger it from the running coordinator container
(point `path` at a file reachable inside that container, e.g. mount `data/` into it):

```bash
curl -X POST http://localhost:4000/api/admin/load-orders \
  -H 'Content-Type: application/json' \
  -d '{"path": "/data/orders_bulk.csv"}'
```

Once loaded, orders sit as `QUEUED` and the coordinator's worker loop picks them up
automatically (poll interval configurable via `POLL_INTERVAL_MS`).

## Running without Docker (local dev)

1. Start a local MySQL 8, then run every file in `db/init/` against it in order (01→06).
2. In each of `services/order-service`, `services/inventory-service`,
   `services/payment-service`, `services/shipping-service`, `services/coordinator`,
   `services/notification-service`: `npm install`, then `npm start`
   (set `DB_HOST`, `DB_USER`, `DB_PASSWORD` env vars as needed — defaults are
   `localhost` / `root` / `root`).
3. In `frontend/`: `npm install && npm start` (serves on :4200 by default,
   talks to the coordinator on `http://localhost:4000` — override via
   `window.__COORDINATOR_API__` if needed).

## Tests

Integration tests exercise the saga engine against the real running stack
(coordinator + all 4 leaf services + MySQL), because that coordination is the thing
actually being tested:

```bash
docker compose up -d
cd services/coordinator
npm test
```

Covers: all steps succeed → `PLACED`; a step fails → everything already done is
undone → `CANCELLED`; re-processing the same order never re-applies an effect
(idempotency).

## Demonstrating the "Needs attention" flow

Load a row from `orders_bulk.csv` where `comp_fail_at` is set (a few rows are
marked this way on purpose) — its `fail_at` step will fail, the coordinator will
try to undo the earlier steps, the marked undo step will keep failing, and the
order will land on `NEEDS_ATTENTION` with a working Retry button in the UI.

## Notes on scaling further

- `docker compose up -d --scale coordinator=3` runs 3 coordinator instances
  sharing the same order queue safely (see `worker.js`).
- For very high step-existence-check throughput beyond what an indexed MySQL
  lookup gives you, a Redis cache in front of `saga_steps`/`idempotency_ledger`
  keyed on `idempotency_key` (write-through on insert, read-through on miss)
  would be the natural next step — the lookup is already a single key
  read/write, so it drops in without changing the saga logic.
