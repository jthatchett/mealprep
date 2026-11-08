// Maintenance holds the weight you started it at: a drift past 1% is won
// back a quarter of the way per check-in; small drifts are left to the
// estimate. And a maintenance check-in that applies itself says so, with Undo.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { maintenanceHold, AutoCheckinNotice, paceKcal } from '../src/App.jsx';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = '2026-11-09'; // a Monday
const day = (n) => { const d = new Date(2026, 10, 9); d.setDate(d.getDate() + n); return iso(d); };
// daily weigh-ins: flat at 180 until `driftFrom` days ago, then losing pctPerWeek
const log = (days, driftFrom, pctPerWeek) => Array.from({ length: days + 1 }, (_, i) => {
  const ago = days - i, wk = Math.max(0, driftFrom - ago) / 7;
  return { date: day(-ago), weight: +(180 * Math.pow(1 + pctPerWeek / 100, wk)).toFixed(2) };
});
const maint = (startAgo) => ({ id: 'm', phase_type: 'maintenance', phase_name: 'Maintenance', start_date: day(-startAgo), end_date: null, planned_end_date: null, target_rate_pct: 0 });

describe('maintenance holds its starting weight', () => {
  it('a drift under 1% is left alone (the check-ins stop it)', () => {
    const h = maintenanceHold(maint(42), [maint(42)], log(49, 28, -0.2), TODAY, []);
    expect(h.gapPct).toBeGreaterThan(-1);
    expect(h.ratePct).toBe(0);
  });
  it('past 1% under, calories aim to close a quarter of it this week', () => {
    const h = maintenanceHold(maint(70), [maint(70)], log(77, 70, -0.2), TODAY, []);
    expect(h.anchor.toFixed(1)).toBe('180.0');
    expect(h.gapLb.toFixed(1)).toBe('-3.4');                   // the last 7 days' average
    expect(h.ratePct).toBeCloseTo(-h.gapPct / 4, 3);           // +0.47%/week
    expect(Math.round(paceKcal(h.ratePct, 176.6))).toBe(419);  // ≈ 3.4 lb × 3,500 ÷ 4 weeks ÷ 7 days
  });
  it("a Keep doesn't count as a week of the correction; it stops once back within 0.25%", () => {
    const rows = [maint(70)];
    const ck = (ago, action, rate) => ({ week_start: day(-ago), action, target_rate_pct: rate });
    // two applied weeks of correction, a kept one between doesn't end it
    const running = maintenanceHold(rows[0], rows, log(77, 70, -0.2), TODAY, [ck(14, 'apply', 0.4), ck(7, 'keep', 0.4)]);
    expect(running.weeksRun).toBe(1);
    expect(running.ratePct).toBeGreaterThan(0);
    // back to 179.7 (−0.17%): done
    const back = log(77, 70, 0).map((r, i, a) => (i >= a.length - 7 ? { ...r, weight: 179.7 } : r));
    expect(maintenanceHold(rows[0], rows, back, TODAY, [ck(7, 'apply', 0.3)])).toMatchObject({ ratePct: 0, done: true });
  });
  it("after a cut, it holds the weight once the water has settled (the day before the pace counts, day 20), not the day the cut ended", () => {
    const cut = { id: 'c', phase_type: 'deficit', phase_name: 'Cut', start_date: day(-120), end_date: day(-15), planned_end_date: day(-15), target_rate_pct: -0.5 };
    const m = maint(14);
    expect(maintenanceHold(m, [cut, m], log(130, 0, 0), TODAY, [])).toMatchObject({ waiting: true, ratePct: 0, anchorDate: day(4) }); // started 14 days ago: day 19 is 4 days from now
  });
  it('cuts and bulks are unaffected', () => {
    expect(maintenanceHold({ ...maint(70), phase_type: 'deficit' }, [], log(77, 70, -0.2), TODAY, [])).toBe(null);
  });
});

describe('a maintenance check-in done for you', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 9, 9)); });
  afterEach(() => vi.useRealTimers());
  const text = (el) => renderToStaticMarkup(el).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const c = (hold = null) => ({
    weekStart: TODAY, weightLb: 176.5, hold,
    thisWeek: { week_start: TODAY, estimate: 2681, action: 'apply', before: { cal: 2500 }, chosen: { p: 145, f: 70, c: 373, cal: 2681, auto: true } },
  });
  it('says what changed and why, with OK and Undo', () => {
    expect(text(React.createElement(AutoCheckinNotice, { c: c(), onUndo: () => {} })))
      .toBe('WEEKLY CHECK-IN Calories 2,500 → 2,681 Your maintenance from the last 3 weeks of logging and weigh-ins is 2,681 kcal. OK Undo (keep 2,500)');
  });
  it('says when it includes winning back a drift', () => {
    const t = text(React.createElement(AutoCheckinNotice, { c: c({ ratePct: 0.49, anchor: 180, gapLb: -3.5 }), onUndo: () => {} }));
    expect(t).toContain('This week includes 432 kcal/day extra to get back to 180.0 lb (you\'re 3.5 lb under).');
  });
});
