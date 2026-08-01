// Usage: DB_HOST=localhost DB_PASSWORD=root node scripts/seed-inventory.js path/to/sample_inventory.csv
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node seed-inventory.js <path-to-sample_inventory.csv>');
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: 'inventory_db',
  });

  const lines = fs.readFileSync(path.resolve(file), 'utf8').trim().split('\n');
  const [, ...rows] = lines; // skip header
  let count = 0;
  for (const line of rows) {
    if (!line.trim()) continue;
    const [sku, qty] = line.split(',').map((v) => v.trim());
    await conn.query(
      `INSERT INTO stock (sku, available_qty) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE available_qty = VALUES(available_qty)`,
      [sku, Number(qty)]
    );
    count++;
  }
  console.log(`Seeded ${count} SKUs into inventory_db.stock`);
  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
