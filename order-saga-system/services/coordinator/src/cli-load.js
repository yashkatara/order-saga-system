const path = require('path');
const { loadOrdersCsv } = require('./loader');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node src/cli-load.js <path-to-orders.csv>');
  process.exit(1);
}

loadOrdersCsv(path.resolve(file), { sourceLabel: path.basename(file) })
  .then((result) => {
    console.log('Load complete:', result);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Load failed:', err);
    process.exit(1);
  });
