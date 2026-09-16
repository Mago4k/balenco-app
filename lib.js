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

  // Round to the cent, half up. The epsilon matters: 5.005 is stored as
  // 5.00499999999999989..., so a plain Math.round(n*100)/100 rounds it DOWN to
  // 5.00 when both the tax rules and the reader expect 5.01.
  function round2(v) { return Math.round((num(v) + Number.EPSILON) * 100) / 100; }

  // Quebec sales tax on a subtotal. tpsRate/tvqRate are percents (e.g. 5 and 9.975).
  //
  // Every value comes back ALREADY ROUNDED to the cent, and the total is the sum
  // of the rounded taxes -- not a rounded sum of unrounded ones. That is what
  // makes a printed invoice foot: the subtotal, the TPS line and the TVQ line are
  // the same numbers the total was built from. Returning raw floats here meant the
  // lines were rounded for display while the total was not, and the two disagreed
  // by a cent on 25% of subtotals.
  //
  // It also matches how the taxes are actually remitted: GST and QST are each
  // computed on the selling price and each rounded (QST has not applied to GST
  // since 2013), so rounding per tax is the correct arithmetic, not a display hack.
  function calc(subtotal, tpsRate, tvqRate) {
    var s = round2(subtotal);
    var tps = round2(s * num(tpsRate) / 100);
    var tvq = round2(s * num(tvqRate) / 100);
    return { tps: tps, tvq: tvq, total: round2(s + tps + tvq) };
  }

  function lineTotal(qty, price) { return num(qty) * num(price); }

  function lineItemsTotal(items) {
    return (items || []).reduce(function (sum, it) {
      return sum + lineTotal(it && it.qty, it && it.price);
    }, 0);
  }

  // Outstanding balance: grand total minus every RECORDED payment.
  //
  // The deposit is deliberately NOT subtracted. It is the amount requested on the
  // quote, not evidence that money arrived — a real deposit is recorded as a
  // payment like any other (migration 0053). Subtracting it here meant an unpaid
  // deposit silently reduced the balance everywhere, and the payment cap then made
  // that money unreachable by card.
  //
  // Rounded to the cent. Without it, paying the displayed amount in full left a
  // float residue in (0, 0.005] — measured on HALF of all subtotals between $100
  // and $30,000 — so the record never read as paid: "Remaining $0.00" with a live
  // pay button, and the client stuck on the still-owed list forever. e.g. subtotal
  // $12,750.55 -> total 14659.944862499999, client pays 14659.94, residue 0.00486.
  function owing(total, payments) {
    var paid = (payments || []).reduce(function (x, p) {
      return x + num(p && p.amount);
    }, 0);
    return Math.max(round2(num(total) - paid), 0);
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
    round2: round2,
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
