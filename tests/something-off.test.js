// "Something off?" on a maintenance check-in that applied itself: which
// reasons show, what each one changes, and what the person is told after.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { checkinReasons, resolveCheckinReason, cantEatMinKcal, AutoCheckinNotice } from '../src/App.jsx';
import { presets } from './fixtures.js';

const ck = (was, now, extra = {}) => ({
  week_start: '2026-11-09', estimate: now, action: 'apply', preset_id: 'phase-maintenance',
  before: { p: 145, f: 80, c: Math.round((was - 580 - 720) / 4), cal: was },
  chosen: { p: 145, f: 80, c: Math.round((now - 580 - 720) / 4), cal: now, auto: true, ...extra },
});
const row = { id: 'm1', phase_type: 'maintenance', start_date: '2026-08-31' };

describe('which reasons show', () => {
  it('"I can\'t eat that" needs a change of 150 kcal, or 6% of calories if that is less', () => {
    expect(cantEatMinKcal(2500)).toBe(150);              // 6% would be 150 too
    expect(cantEatMinKcal(3000)).toBe(150);              // 6% is 180: 150 is less
    expect(Math.round(cantEatMinKcal(1700))).toBe(102); // 125 lb person: 6% is 102
    expect(checkinReasons(ck(2500, 2640), null)).not.toContain('cant-eat'); // +140 at 2,500: routine
    expect(checkinReasons(ck(2500, 2681), null)).toContain('cant-eat');     // +181
    expect(checkinReasons(ck(1700, 1800), null)).not.toContain('cant-eat'); // +100 at 1,700
    expect(checkinReasons(ck(1700, 1810), null)).toContain('cant-eat');     // +110 at 1,700 (6.5%)
  });
  it('"Hold my current weight" only while winning back a drift', () => {
    expect(checkinReasons(ck(2500, 2681), { ratePct: 0 })).toEqual(['log', 'temporary', 'slow', 'cant-eat']);
    expect(checkinReasons(ck(2500, 2900), { ratePct: 0.3 })).toEqual(['log', 'temporary', 'slow', 'hold-reset', 'cant-eat']);
  });
});

describe('what each reason changes', () => {
  const k = ck(2500, 2681);
  const go = (r, opts = {}) => resolveCheckinReason(r, { ck: k, row, weightLb: 179, today: '2026-11-09', ...opts });
  it('incomplete log: the check-in is withdrawn, target back, days open to fix', () => {
    expect(go('log')).toEqual({ remove: true, target: k.before, reviewDays: true });
  });
  it('temporarily off: this week stays at 2,500, recorded as a Keep with the reason', () => {
    expect(go('temporary')).toEqual({ patch: { action: 'keep', chosen: { auto: true, reason: 'temporary' } }, target: { p: 145, f: 80, c: 300, cal: 2500 } });
  });
  it('lose slowly: a cut at −0.25%/week starts; gain slowly: a bulk at +0.5%/month', () => {
    expect(go('slow-cut').start).toEqual({ type: 'deficit', ratePct: -0.25 });
    expect(go('slow-bulk').start.ratePct * (30.44 / 7)).toBeCloseTo(0.5, 3);
  });
  it("hold my current weight: plain maintenance from now, and the correction's pace is cleared", () => {
    const r = go('hold-reset', { ck: { ...k, chosen: { ...k.chosen, cal: 2900 }, estimate: 2681 } });
    expect(r.target.cal).toBe(2681);
    expect(r.patch.target_rate_pct).toBe(0);
    expect(r.holdFrom).toEqual({ rowId: 'm1', date: '2026-11-09' });
  });
  it("can't eat it: halfway (2,590, carbs take it) or stay this week", () => {
    const half = go('cant-eat', { half: true });
    expect(half.target).toMatchObject({ p: 145, f: 80, cal: 2591 });
    expect(half.patch.chosen.reason).toBe('cant-eat-half');
    expect(go('cant-eat').patch).toEqual({ action: 'keep', chosen: { auto: true, reason: 'cant-eat' } });
  });
});

describe('what they read after choosing', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 9, 9)); });
  afterEach(() => vi.useRealTimers());
  const text = (el) => renderToStaticMarkup(el).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const notice = (chosenExtra, kept = true, last = null) => {
    const k = ck(2500, 2681, chosenExtra);
    if (kept) k.action = 'keep';
    return text(React.createElement(AutoCheckinNotice, { c: { weekStart: '2026-11-09', today: '2026-11-09', weightLb: 179, hold: null, thisWeek: k, last }, phases: presets(), onReason: () => {} }));
  };
  it('temporarily off', () => {
    expect(notice({ reason: 'temporary' })).toBe("WEEKLY CHECK-IN Got it. Your calories stay at 2,500 this week. Next week's check-in will update them again. OK");
  });
  it("can't eat it: the cost, in pounds a week", () => {
    expect(notice({ reason: 'cant-eat' })).toContain("Got it. 2,500 this week: at that you'll lose about 0.4 lb a week. Next week's check-in will update them again.");
  });
});
