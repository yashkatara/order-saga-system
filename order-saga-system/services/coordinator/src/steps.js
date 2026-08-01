const ORDER_URL = process.env.ORDER_SERVICE_URL || 'http://localhost:4001';
const INVENTORY_URL = process.env.INVENTORY_SERVICE_URL || 'http://localhost:4002';
const PAYMENT_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:4003';
const SHIPPING_URL = process.env.SHIPPING_SERVICE_URL || 'http://localhost:4004';

// The saga is driven entirely from this table: which service does the DO,
// which endpoint undoes it. Order of this array is also the compensation
// order used when unwinding (reverse of the do order).
const STEPS = [
  {
    name: 'ORDER',
    doUrl: (orderId) => `${ORDER_URL}/orders/${orderId}/create`,
    undoUrl: (orderId) => `${ORDER_URL}/orders/${orderId}/cancel`,
  },
  {
    name: 'STOCK',
    doUrl: (orderId) => `${INVENTORY_URL}/orders/${orderId}/reserve`,
    undoUrl: (orderId) => `${INVENTORY_URL}/orders/${orderId}/release`,
  },
  {
    name: 'PAYMENT',
    doUrl: (orderId) => `${PAYMENT_URL}/orders/${orderId}/charge`,
    undoUrl: (orderId) => `${PAYMENT_URL}/orders/${orderId}/refund`,
  },
  {
    name: 'SHIPPING',
    doUrl: (orderId) => `${SHIPPING_URL}/orders/${orderId}/arrange`,
    undoUrl: (orderId) => `${SHIPPING_URL}/orders/${orderId}/cancel`,
  },
];

module.exports = { STEPS };
