/*
 * Tests for the Balenco money math (lib.js). Run with: node --test
 * These guard the tax/total/balance/line-item formulas against regressions.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Lib = require('./lib.js');

test('calc — Quebec TPS/TVQ on the Dayacre subtotal', () => {
  const r = Lib.calc(11275.36, 5, 9.975);
  assert.equal(r.tps.toFixed(2), '563.77');
  assert.equal(r.tvq.toFixed(2), '1124.72');   // auto-computed (the invoice used a manual 1124.71)
  assert.equal(r.total.toFixed(2), '12963.85');
});

test('calc — default Quebec rates (5 / 9.975) on $1000', () => {
  const r = Lib.calc(1000, 5, 9.975);
  assert.equal(r.tps.toFixed(2), '50.00');
  assert.equal(r.tvq.toFixed(2), '99.75');
  assert.equal(r.total.toFixed(2), '1149.75');
});

test('calc — zero / missing / non-numeric subtotal is safe', () => {
  assert.deepEqual(Lib.calc(0, 5, 9.975), { tps: 0, tvq: 0, total: 0 });
  assert.deepEqual(Lib.calc(undefined, 5, 9.975), { tps: 0, tvq: 0, total: 0 });
  assert.deepEqual(Lib.calc('abc', 5, 9.975), { tps: 0, tvq: 0, total: 0 });
});

test('calc — zero tax rates produce no tax', () => {
  assert.deepEqual(Lib.calc(500, 0, 0), { tps: 0, tvq: 0, total: 500 });
});

test('lineTotal — qty x price', () => {
  assert.equal(Lib.lineTotal(16, 65), 1040);
  assert.equal(Lib.lineTotal(56, 11.50), 644);
  assert.equal(Lib.lineTotal(1, 0), 0);
  assert.equal(Lib.lineTotal(undefined, 65), 0);
});

test('lineItemsTotal — sums the Dayacre items', () => {
  const items = [
    { qty: 16, price: 65 }, { qty: 32, price: 65 }, { qty: 56, price: 11.5 },
    { qty: 12, price: 65 }, { qty: 24, price: 65 }
  ];
  assert.equal(Lib.lineItemsTotal(items).toFixed(2), '6104.00');
  assert.equal(Lib.lineItemsTotal([]), 0);
  assert.equal(Lib.lineItemsTotal(undefined), 0);
});

test('owing — total minus deposit and payments, floored at zero', () => {
  assert.equal(Lib.owing(1149.75, 500, [{ amount: 200 }]).toFixed(2), '449.75');
  assert.equal(Lib.owing(1000, 0, []), 1000);
  assert.equal(Lib.owing(1000, 600, [{ amount: 500 }]), 0);   // overpaid -> 0, never negative
  assert.equal(Lib.owing(1000, 0, [{ amount: 250 }, { amount: 250 }]), 500);
  assert.equal(Lib.owing(0, 0, []), 0);
});

test('owing — paid-in-full job nets to zero', () => {
  const total = Lib.calc(20, 5, 9.975).total;       // $22.995 -> $23.00 charged
  assert.equal(Lib.owing(total, 0, [{ amount: total }]), 0);
});

test('money — CAD formatting', () => {
  assert.equal(Lib.money(12963.84), '$12,963.84');
  assert.equal(Lib.money(1040), '$1,040.00');
  assert.equal(Lib.money(0), '$0.00');
  assert.equal(Lib.money(undefined), '$0.00');
});
