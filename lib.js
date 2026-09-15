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

  // One CSV cell, quoted and safe to open in Excel.
  //
  // The leading-character guard is the important part: a value starting with
  // = + - @ tab or CR is interpreted as a FORMULA by Excel/Sheets, so a client
  // named `=cmd|...` in an exported file becomes code on the accountant's
  // machine. Prefixing with an apostrophe forces it to stay text.
  function csvCell(value) {
    var s = String(value == null ? '' : value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  // Normalise a line item. Hand-entered rows use desc/qty/price; AI-drafted ones
  // arrive as description/quantity/unit_price. Read both so neither renders blank
  // or silently prices at zero.
  function itemFields(it) {
    it = it || {};
    return {
      desc: it.desc || it.description || '',
      qty: num(it.qty != null ? it.qty : (it.quantity != null ? it.quantity : 1)),
      price: num(it.price != null ? it.price : (it.unit_price != null ? it.unit_price : 0)),
      unit: it.unit || ''
    };
  }

  // The dates a recurring appointment series should land on, after `startISO`.
  //
  // Steps by CALENDAR units, not by fixed milliseconds. Adding 7*86400000 drifts
  // an hour whenever the series crosses a daylight-saving boundary, so a 9:00
  // weekly job silently became 8:00 in November. setDate()/setMonth() move the
  // wall-clock time instead, which is what a person means by "same time next week".
  //
  // Monthly also clamps to the end of the target month: setMonth(+1) on Jan 31
  // overflows to Mar 3, which both skips February and permanently shifts the whole
  // series onto the 3rd. Jan 31 -> Feb 28 (or 29) -> Mar 31 keeps the anchor day.
  function recurrenceDates(startISO, freq, endDate, maxOverride) {
    var caps = { weekly: 52, biweekly: 26, monthly: 12 };
    var max = maxOverride || caps[freq] || 12;
    var stepDays = { weekly: 7, biweekly: 14 }[freq];
    if (freq !== 'monthly' && !stepDays) return [];

    var base = new Date(startISO);
    if (isNaN(base.getTime())) return [];
    var limit = endDate ? new Date(endDate) : null;
    if (limit && isNaN(limit.getTime())) limit = null;

    var anchorDom = base.getDate();
    var out = [];
    var cur = new Date(base.getTime());

    for (var i = 0; i < max; i++) {
      var next = new Date(cur.getTime());
      if (freq === 'monthly') {
        next.setDate(1);                       // avoid overflow while changing month
        next.setMonth(next.getMonth() + 1);
        var daysInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        next.setDate(Math.min(anchorDom, daysInMonth));
        next.setHours(base.getHours(), base.getMinutes(), base.getSeconds(), base.getMilliseconds());
      } else {
        next.setDate(next.getDate() + stepDays);
      }
      if (limit && next > limit) break;
      out.push(next);
      cur = next;
    }
    return out;
  }

  var Lib = {
    calc: calc,
    lineTotal: lineTotal,
    lineItemsTotal: lineItemsTotal,
    owing: owing,
    money: money,
    csvCell: csvCell,
    itemFields: itemFields,
    recurrenceDates: recurrenceDates
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Lib;
  root.BalencoLib = Lib;
})(typeof globalThis !== 'undefined' ? globalThis : this);
