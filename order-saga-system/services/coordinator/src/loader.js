const fs = require('fs');
const readline = require('readline');
const pool = require('./db');

const INSERT_BATCH_SIZE = Number(process.env.LOADER_BATCH_SIZE || 500);

function parseCsvLine(line) {
  // Simple CSV split -- input file has no quoted/escaped commas, so this
  // avoids pulling in a dependency just for the loader.
  return line.split(',').map((v) => v.trim());
}

// Streams the file line-by-line (readline over a fs.ReadStream) so a file far
// larger than the sample never has to be held in memory at once. Inserts in
// batches. Re-loading the same file is a no-op for rows already ingested,
// thanks to the PK on orders.order_id / ingested_orders.order_id --
// duplicates are silently skipped, not re-queued.
async function loadOrdersCsv(filePath, { sourceLabel } = {}) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let header = null;
  let batch = [];
  let totalRead = 0;
  let totalInserted = 0;

  async function flush() {
    if (batch.length === 0) return;
    const conn = await pool.getConnection();
    try {
      const values = batch.map((o) => [o.order_id, o.sku, o.qty, o.amount, o.fail_at || null, o.comp_fail_at || null]);
      const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, "QUEUED")').join(',');
      const flat = values.flat();
      const [result] = await conn.query(
        `INSERT IGNORE INTO orders (order_id, sku, qty, amount, fail_at, comp_fail_at, status)
         VALUES ${placeholders}`,
        flat
      );
      totalInserted += result.affectedRows;

      const ingestValues = batch.map((o) => [o.order_id, sourceLabel || filePath]);
      await conn.query(
        `INSERT IGNORE INTO ingested_orders (order_id, source_file) VALUES ${batch.map(() => '(?, ?)').join(',')}`,
        ingestValues.flat()
      );
    } finally {
      conn.release();
    }
    batch = [];
  }

  for await (const line of rl) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (!header) {
      header = cols;
      continue;
    }
    totalRead++;
    const row = Object.fromEntries(header.map((h, i) => [h, cols[i]]));
    batch.push({
      order_id: row.order_id,
      sku: row.sku,
      qty: Number(row.qty),
      amount: Number(row.amount),
      fail_at: row.fail_at || null,
      comp_fail_at: row.comp_fail_at || null,
    });
    if (batch.length >= INSERT_BATCH_SIZE) await flush();
  }
  await flush();

  return { totalRead, totalInserted };
}

module.exports = { loadOrdersCsv };
