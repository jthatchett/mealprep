// Behind plan on a cut: the label says so even when the last 2 weeks are on
// pace, and three ways back each redraw the plan from today.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { planStatus, behindOptions, behindVerdict, Phases, PhaseCard } from '../src/App.jsx';
import { presets } from './fixtures.js';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = '2026-11-08';
const day = (n) => { const d = new Date(2026, 10, 8); d.setDate(d.getDate() + n); return iso(d); };
// daily weigh-ins from 181 lb, losing pctPerWeek
const log = (days, pctPerWeek) => Array.from({ length: days + 1 }, (_, i) => ({ date: day(i - days), weight: +(181 * Math.pow(1 + pctPerWeek / 100, i / 7)).toFixed(2) }));
// a 12-week cut at −0.5%/week, 5 weeks in, really losing 0.3%/week
const cut = { id: 'r1', phase_id: 'phase-cut', phase_type: 'deficit', phase_name: 'Cut', start_date: day(-35), end_date: null, planned_end_date: day(48), target_rate_pct: -0.5 };
const bw = log(42, -0.3);

describe('behind plan', () => {
  it('1.8 lb heavier than the plan, more than a week of the goal pace (0.9 lb): behind', () => {
    const s = planStatus(cut, null, bw, TODAY);
    expect(s.wts.planNow.toFixed(1)).toBe('176.2');
    expect(s.wts.now.toFixed(1)).toBe('178.0');
    expect(s.behindLb.toFixed(1)).toBe('1.8');
    expect(s.behind).toBe(true);
  });
  it('the label keeps the 2-week verdict and adds the plan', () => {
    const s = planStatus(cut, null, bw, TODAY);
    expect(behindVerdict({ ok: true, text: 'On pace' }, s)).toEqual({ ok: false, text: 'On pace now · 1.8 lb behind plan' });
    expect(behindVerdict({ ok: false, text: 'Losing slower than target' }, s).text).toBe('Losing slower than target · 1.8 lb behind plan');
  });
  it('within a week of the pace, or ahead, nothing changes', () => {
    expect(planStatus(cut, null, log(42, -0.42), TODAY).behind).toBe(false);
    expect(planStatus(cut, null, log(42, -0.8), TODAY).behind).toBe(false);
  });
  it('after re-planning, the plan runs from that day: back on plan', () => {
    const s = planStatus(cut, { planFrom: { rowId: 'r1', date: TODAY } }, bw, TODAY);
    expect(s.anchorDate).toBe(TODAY);
    expect(s.behind).toBe(false);
  });
});

describe('the three ways back (178.0 lb today, goal 170.1 by Dec 26, 7 weeks left)', () => {
  const s = planStatus(cut, null, bw, TODAY);
  const o = behindOptions({ row: cut, wts: s.wts, today: TODAY });
  it('finish later: the same goal at the same pace, about 2 weeks later', () => {
    expect(o.later.goal.toFixed(1)).toBe('170.1');
    expect(o.later.end).toBe(day(62)); // Jan 9 instead of Dec 26
  });
  it('same date, lighter goal', () => {
    expect(o.lighter.goal.toFixed(1)).toBe('171.9');
    expect(o.lighter.end).toBe(day(48));
  });
  it('same date and goal, faster: 0.64%/week (1.1 lb), inside the limits, no warning', () => {
    expect(o.faster.ratePct).toBeCloseTo(-0.643, 3);
    expect(o.faster.warning).toBe(null);
  });
  it("finishing later can't run into the next planned phase", () => {
    expect(behindOptions({ row: cut, wts: s.wts, today: TODAY, nextStart: day(55) }).later.blockedBy).toBe(day(55));
  });
  it('too far behind: faster gets a warning, and past the 1.5%/week limit it is not offered', () => {
    const short = { ...cut, planned_end_date: day(20) }; // 3 weeks left
    expect(behindOptions({ row: short, wts: { now: 180, goalEnd: 174 }, today: TODAY }).faster.warning).toMatch(/faster than the 0.5–1.0 %\/week range/);
    expect(behindOptions({ row: short, wts: { now: 180, goalEnd: 170 }, today: TODAY }).faster).toBe(null);
  });
  it('an open-ended bulk has no end to move: just plan from today', () => {
    expect(behindOptions({ row: { ...cut, phase_type: 'surplus', planned_end_date: null, target_rate_pct: 0.23 }, wts: { now: 180, goalEnd: null }, today: TODAY })).toEqual({ restart: true });
  });
});

describe('where it shows', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 8, 12)); });
  afterEach(() => vi.useRealTimers());
  const text = (el) => renderToStaticMarkup(el).replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  it('the Plan card: "behind plan" and the way back', () => {
    const t = text(React.createElement(PhaseCard, { dietPhases: [cut], bwLog: bw, presets: presets(), week: null, estimate: null, onOpenMonth: () => {}, onReplan: async () => {}, hasRepReport: false }));
    expect(t).toMatch(/1\.8 lb behind plan/);
    expect(t).toContain('Get back on plan ›');
  });
  it('the Phases card: the label only', () => {
    const t = text(React.createElement(Phases, {
      phases: presets(), setPhases: () => {}, dietPhase: cut, dietPhases: [cut], bwLog: bw, targetHistory: [],
      coaching: { basis: { kcal: 2500, source: 'learned', asOf: day(-6) }, weightLb: 178, due: false, grounded: true, thisWeek: null, last: null },
      onSavePreset: () => {}, onSaveActive: async () => true, onSwitchPhase: () => {}, onOpenCalendar: () => {}, onOpenCalc: () => {},
    }));
    expect(t).toMatch(/1\.8 lb behind plan/);
    expect(t).not.toContain('Get back on plan');
  });
});
