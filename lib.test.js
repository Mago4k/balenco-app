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

// An invoice foots when the numbers PRINTED on it add up. Each line is rendered
// rounded to the cent, so the check has to be done on the rounded values -- which
// is what the person reading the invoice does. calc() used to return unrounded
// floats, so the total disagreed with its own tax lines on 25% of subtotals.
test('calc — a printed invoice always foots', () => {
  const r2 = (n) => Math.round(n * 100) / 100;
  for (const [tps, tvq] of [[5, 9.975], [5, 0], [0, 0], [5, 8]]) {
    for (let cents = 1; cents <= 50000; cents++) {
      const s = cents / 100;
      const r = Lib.calc(s, tps, tvq);
      assert.equal(
        r2(r2(s) + r2(r.tps) + r2(r.tvq)).toFixed(2),
        r2(r.total).toFixed(2),
        'does not foot at subtotal ' + s + ' @ ' + tps + '/' + tvq
      );
    }
  }
});

// GST and QST are each computed on the selling price and each rounded to the
// cent, so a half-cent must round UP. 5.005 is stored just below 5.005, which a
// plain Math.round(n*100)/100 sends the wrong way.
test('calc — a half cent rounds up, not down', () => {
  assert.equal(Lib.calc(100.10, 5, 9.975).tps, 5.01);
  assert.equal(Lib.round2(5.005), 5.01);
  assert.equal(Lib.round2(1.005), 1.01);
  assert.equal(Lib.round2(2.675), 2.68);
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

test('owing — total minus recorded payments, floored at zero', () => {
  assert.equal(Lib.owing(1149.75, [{ amount: 500 }, { amount: 200 }]).toFixed(2), '449.75');
  assert.equal(Lib.owing(1000, []), 1000);
  assert.equal(Lib.owing(1000, [{ amount: 1100 }]), 0);   // overpaid -> 0, never negative
  assert.equal(Lib.owing(1000, [{ amount: 250 }, { amount: 250 }]), 500);
  assert.equal(Lib.owing(0, []), 0);
  assert.equal(Lib.owing(1000, undefined), 1000);
});

test('owing — a deposit is NOT evidence of payment', () => {
  // `deposit` is the amount REQUESTED on the quote. Only recorded payments reduce
  // the balance; migration 0053 converted real deposits into payment rows. It used
  // to be subtracted here, so an unpaid deposit silently discounted the balance
  // everywhere — and the payment cap then put that money out of reach by card.
  assert.equal(Lib.owing(1149.75, []), 1149.75);
  assert.equal(Lib.owing(1149.75, [{ amount: 1149.75 }]), 0);
});

test('owing — paying the displayed total in full always reaches exactly zero', () => {
  // Regression guard. owing() returned a raw float, so paying the amount actually
  // shown left a residue in (0, 0.005] on ~50% of subtotals between $100 and
  // $30,000: the record read "Remaining $0.00" with a live pay button forever and
  // the client never left the still-owed list.
  for (const subtotal of [20, 180, 1500, 2450.33, 8500, 12750.55, 99.99, 100.07]) {
    const total = Lib.calc(subtotal, 5, 9.975).total;
    const shown = Number(total.toFixed(2));            // what the client is asked to pay
    assert.equal(Lib.owing(total, [{ amount: shown }]), 0,
      'subtotal ' + subtotal + ' left a residue after paying ' + shown);
  }
});

test('money — CAD formatting', () => {
  assert.equal(Lib.money(12963.84), '$12,963.84');
  assert.equal(Lib.money(1040), '$1,040.00');
  assert.equal(Lib.money(0), '$0.00');
  assert.equal(Lib.money(undefined), '$0.00');
});

// ── csvCell — the export guard that keeps a client name from becoming a formula ──
test('csvCell — quotes, escapes, and neutralises formula injection', () => {
  assert.equal(Lib.csvCell('Beaulieu'), '"Beaulieu"');
  assert.equal(Lib.csvCell('Beaulieu "Fils"'), '"Beaulieu ""Fils"""');   // quotes doubled
  assert.equal(Lib.csvCell('Deck, rear'), '"Deck, rear"');               // comma is safe inside quotes
  assert.equal(Lib.csvCell(''), '""');
  assert.equal(Lib.csvCell(null), '""');
  assert.equal(Lib.csvCell(undefined), '""');
  assert.equal(Lib.csvCell(1040), '"1040"');
});

test('csvCell — every Excel formula trigger is prefixed', () => {
  for (const bad of ['=1+1', '+1', '-1', '@SUM(A1)', '\t=1', '\r=1']) {
    assert.equal(Lib.csvCell(bad)[1], "'", `expected leading apostrophe for ${JSON.stringify(bad)}`);
  }
  // A real negative number is also prefixed — accepted trade-off: Excel shows it
  // as text rather than letting "-2+3" execute. Money columns are formatted first.
  assert.equal(Lib.csvCell('-500'), `"'-500"`);
});

// ── itemFields — hand-entered vs AI-drafted line items ──────────────────────
test('itemFields — reads both line-item shapes', () => {
  assert.deepEqual(Lib.itemFields({ desc: 'Deck', qty: 2, price: 50 }),
    { desc: 'Deck', qty: 2, price: 50, unit: '' });
  assert.deepEqual(Lib.itemFields({ description: 'Deck', quantity: 2, unit_price: 50, unit: 'sq ft' }),
    { desc: 'Deck', qty: 2, price: 50, unit: 'sq ft' });
});

test('itemFields — missing/zero values do not become wrong money', () => {
  assert.deepEqual(Lib.itemFields({}), { desc: '', qty: 1, price: 0, unit: '' });
  assert.equal(Lib.itemFields({ qty: 0 }).qty, 0);        // explicit 0 stays 0, not defaulted to 1
  assert.equal(Lib.itemFields({ price: 0 }).price, 0);
  assert.equal(Lib.itemFields({ qty: 'abc' }).qty, 0);    // junk -> 0, never NaN in a total
  assert.deepEqual(Lib.itemFields(null), { desc: '', qty: 1, price: 0, unit: '' });
});

// ── recurrenceDates — scheduling that turns into invoices ───────────────────
const hhmm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
const ymd  = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

test('recurrenceDates — weekly keeps the wall-clock time across a DST change', () => {
  // 2026-10-25 09:00 local, weekly. North American DST ends 2026-11-01, so a
  // fixed-millisecond step would silently move later dates to 08:00.
  const out = Lib.recurrenceDates('2026-10-25T09:00:00', 'weekly', null, 4);
  assert.equal(out.length, 4);
  for (const d of out) assert.equal(hhmm(d), '09:00', `drifted to ${hhmm(d)} on ${ymd(d)}`);
  assert.deepEqual(out.map(ymd), ['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22']);
});

test('recurrenceDates — biweekly steps 14 calendar days', () => {
  const out = Lib.recurrenceDates('2026-01-01T08:30:00', 'biweekly', null, 3);
  assert.deepEqual(out.map(ymd), ['2026-01-15', '2026-01-29', '2026-02-12']);
  for (const d of out) assert.equal(hhmm(d), '08:30');
});

test('recurrenceDates — monthly clamps month-end instead of overflowing', () => {
  // Jan 31 + 1 month via setMonth() overflows to Mar 3, skipping February AND
  // shifting every later date onto the 3rd.
  const out = Lib.recurrenceDates('2026-01-31T10:00:00', 'monthly', null, 4);
  assert.deepEqual(out.map(ymd), ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  for (const d of out) assert.equal(hhmm(d), '10:00');
});

test('recurrenceDates — leap year February', () => {
  const out = Lib.recurrenceDates('2028-01-31T10:00:00', 'monthly', null, 1);
  assert.equal(ymd(out[0]), '2028-02-29');
});

test('recurrenceDates — stops at the end date, and respects the caps', () => {
  assert.equal(Lib.recurrenceDates('2026-01-01T09:00:00', 'weekly', '2026-01-20').length, 2); // 8th, 15th
  assert.equal(Lib.recurrenceDates('2026-01-01T09:00:00', 'weekly', null).length, 52);
  assert.equal(Lib.recurrenceDates('2026-01-01T09:00:00', 'biweekly', null).length, 26);
  assert.equal(Lib.recurrenceDates('2026-01-01T09:00:00', 'monthly', null).length, 12);
});

test('recurrenceDates — bad input yields no series rather than throwing', () => {
  assert.deepEqual(Lib.recurrenceDates('not-a-date', 'weekly', null), []);
  assert.deepEqual(Lib.recurrenceDates('2026-01-01T09:00:00', 'yearly', null), []);
  assert.deepEqual(Lib.recurrenceDates('2026-01-01T09:00:00', '', null), []);
});
