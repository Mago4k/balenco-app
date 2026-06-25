/*
 * Balenco shared money math — the single source of truth for Quebec taxes,
 * totals, line items, balances and currency formatting.
 *
 * Pure functions only: no DOM, no app state. Rates and values are passed in,
 * so the exact same code runs in the browser (global `BalencoLib`, loaded by
 * index.html) and under `node --test` (lib.test.js) in CI. Don't add app logic
 * here — keep it pure so it stays testable.
 */
(function (root) {
  'use strict';

  function num(v) { return Number(v) || 0; }

  // Quebec sales tax on a subtotal. Returns RAW (unrounded) floats — format for
  // display with money(). tpsRate/tvqRate are percents (e.g. 5 and 9.975).
  function calc(subtotal, tpsRate, tvqRate) {
    var s = num(subtotal);
    var tps = s * num(tpsRate) / 100;
    var tvq = s * num(tvqRate) / 100;
    return { tps: tps, tvq: tvq, total: s + tps + tvq };
  }

  function lineTotal(qty, price) { return num(qty) * num(price); }

  function lineItemsTotal(items) {
    return (items || []).reduce(function (sum, it) {
      return sum + lineTotal(it && it.qty, it && it.price);
    }, 0);
  }

  // Outstanding balance: grand total minus the deposit and every recorded
  // payment, never below zero.
  function owing(total, deposit, payments) {
    var paid = num(deposit) + (payments || []).reduce(function (x, p) {
      return x + num(p && p.amount);
    }, 0);
    return Math.max(num(total) - paid, 0);
  }

  function money(value) {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency', currency: 'CAD', maximumFractionDigits: 2
    }).format(num(value));
  }

  var Lib = {
    calc: calc,
    lineTotal: lineTotal,
    lineItemsTotal: lineItemsTotal,
    owing: owing,
    money: money
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Lib;
  root.BalencoLib = Lib;
})(typeof globalThis !== 'undefined' ? globalThis : this);
