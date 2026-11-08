// Maintenance holds the weight you started it at: a drift past 1% is won
// back a quarter of the way per check-in; small drifts are left to the
// estimate. And a maintenance check-in that applies itself says so, with Undo.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { maintenanceHold, AutoCheckinNotice, CatchUpProposal, paceKcal, checkinMaxChange, suggestTargets } from '../src/App.jsx';

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
  it('it starts at the cap (any gap past 1% is over it), and tapers to a quarter a week near the end', () => {
    const rows = [maint(70)];
    const start = maintenanceHold(rows[0], rows, log(77, 70, -0.12), TODAY, []);
    expect(start.gapPct).toBeLessThan(-1);
    expect(start.ratePct).toBeCloseTo(1 / (30.44 / 7), 3);
    // a running catch-up 0.6% under: a quarter of it, 0.15%/week
    const near = maintenanceHold(rows[0], rows, log(77, 35, -0.12), TODAY, [{ week_start: day(-7), action: 'apply', target_rate_pct: 0.23 }]);
    expect(near.gapPct).toBeGreaterThan(-0.92);
    expect(near.ratePct).toBeCloseTo(-near.gapPct / 4, 3);
  });
  it('past 1% under, calories aim to close a quarter of it this week, at most +1%/month', () => {
    const h = maintenanceHold(maint(70), [maint(70)], log(77, 70, -0.2), TODAY, []);
    expect(h.anchor.toFixed(1)).toBe('180.0');
    expect(h.gapLb.toFixed(1)).toBe('-3.4');                   // the last 7 days' average
    // a quarter of 1.9% would be +0.47%/week; capped at the default bulk pace, +1%/month
    expect(h.ratePct).toBeCloseTo(1 / (30.44 / 7), 3);         // +0.23%/week
    expect(Math.round(paceKcal(h.ratePct, 176.6))).toBe(203);  // ≈ 0.4 lb a week
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
    weekStart: TODAY, weightLb: 176.5, hold: hold && { now: 176.5, ...hold },
    thisWeek: { week_start: TODAY, estimate: 2681, action: 'apply', before: { cal: 2500 }, chosen: { p: 145, f: 70, c: 373, cal: 2681, auto: true } },
  });
  it('says what changed and why, with OK and "Something off?"', () => {
    expect(text(React.createElement(AutoCheckinNotice, { c: c(), onReason: () => {} })))
      .toBe('WEEKLY CHECK-IN Calories 2,500 → 2,681 Your maintenance from the last 3 weeks of logging and weigh-ins is 2,681 kcal. OK Something off?');
  });
  it("the first one from their data says it replaced the starting estimate, and what that means from now on", () => {
    const first = { ...c(), firstData: true, prior: 2500, hold: { ratePct: 0 } };
    expect(text(React.createElement(AutoCheckinNotice, { c: first, onReason: () => {} })))
      .toBe("WEEKLY CHECK-IN Calories 2,500 → 2,681 Your real maintenance is 2,681 calories. That's 181 more than the starting estimate. Each weekly check-in fine-tunes it from your latest logging and weigh-ins. OK Something off?");
  });
  it('later weeks lead with what is left', () => {
    const t = text(React.createElement(AutoCheckinNotice, { c: c({ ratePct: 0.49, anchor: 180, gapLb: -3.5 }), onReason: () => {} }));
    expect(t).toBe('WEEKLY CHECK-IN 3.5 lb to go Back to 180.0 lb at about 0.9 lb a week. Calories 2,681 this week. OK Something off?');
  });
  it("the week a catch-up starts: the fact, the action, the pace in pounds", () => {
    const t = text(React.createElement(AutoCheckinNotice, { c: c({ ratePct: 0.49, anchor: 180, gapLb: -3.5, gapPct: -1.94, weeksRun: 0, now: 176.5 }), onReason: () => {} }));
    expect(t).toBe("WEEKLY CHECK-IN You're 3.5 lb under your maintenance weight You started maintenance at 180.0 lb. You're at 176.5 now. To get back: about 2,680 calories a day (430 over maintenance, ≈0.9 lb a week). OK");
  });
  it('before it starts, it asks: OK, or stay where you are (the usual case: back from the holidays)', () => {
    // holding 180.0 since Oct 6, 182.4 after the holidays: down at the capped pace
    const hold = { ratePct: -0.23, anchor: 180, anchorDate: '2026-10-06', gapLb: 2.4, gapPct: 1.33, weeksRun: 0, now: 182.4 };
    expect(text(React.createElement(CatchUpProposal, { c: { hold, suggestion: { cal: 2480 } }, onAccept: () => {}, onHoldCurrent: () => {} })))
      .toBe("WEEKLY CHECK-IN You're 2.4 lb over your maintenance weight You started maintenance at 180.0 lb on Oct 6. You're at 182.4 now. To get back: about 2,480 calories a day (210 under maintenance, ≈0.4 lb a week). OK Stay at 182.4 lb");
  });
});

describe('maintenance check-ins move calories all the way', () => {
  it('no weekly step at maintenance; cuts and bulks keep theirs', () => {
    expect(checkinMaxChange('maintenance', true)).toBe(Infinity);
    expect(checkinMaxChange('deficit', true)).toBe(300);
    expect(checkinMaxChange('surplus', false)).toBe(250);
  });
  it('a calculator 20% low: the first check-in goes straight to maintenance plus the catch-up, not 300 at a time', () => {
    // guessed 2,140, real 2,680, 2.4 lb under at 177.6: +0.23%/week ≈ +204 kcal
    const current = { p: 145, f: 70, c: 228, cal: 2140 };
    const s = suggestTargets({ estimate: 2680, ratePctPerWeek: 1 / (30.44 / 7), weightLb: 177.6, current, phaseType: 'maintenance', maxChange: checkinMaxChange('maintenance', true) });
    expect(s.cal).toBe(2884);
    expect(s.capped).toBe(false);
    // what the old step gave that week: still 240 under maintenance
    expect(suggestTargets({ estimate: 2680, ratePctPerWeek: 1 / (30.44 / 7), weightLb: 177.6, current, phaseType: 'maintenance', maxChange: 300 }).cal).toBe(2440);
  });
});
