// Eating well off target, with the scale agreeing: the warning fires only
// when both say the same thing, in any phase.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { intakeVsTarget, intakeWarning, IntakeWarning, calVsMaintenance } from '../src/App.jsx';
import { presets } from './fixtures.js';

const cut = (ate, actualPct) => intakeWarning({ type: 'deficit', intake: { days: 7, ate, target: 2050 }, actualPct, goalPct: -0.5 });

describe('a cut at 0.5%/week (0.9 lb at 180 lb), target 2,050', () => {
  it('300 under and losing 1.4 lb/wk (0.78%): warn', () => {
    expect(cut(1750, -0.78)).toEqual({ under: true, kcal: 300 });
  });
  it('300 under but the scale is on pace: no (probably a logging gap)', () => {
    expect(cut(1750, -0.5)).toBe(null);
  });
  it('eating on target and losing fast: no (maintenance is higher than estimated; the check-in handles it)', () => {
    expect(cut(2050, -0.78)).toBe(null);
  });
  it('only 150 under: no (inside normal logging error)', () => {
    expect(cut(1900, -0.78)).toBe(null);
  });
  it('the scale has to be past the on-pace band (0.2%/week faster), not just a little fast', () => {
    expect(cut(1750, -0.65)).toBe(null);
    expect(cut(1750, -0.71)).not.toBe(null);
  });
});

describe('the mirror on a bulk, and maintenance either way', () => {
  it('a bulk at +1%/month: 300 over and gaining 3.5%/month (≈0.8 lb/wk at 180)', () => {
    expect(intakeWarning({ type: 'surplus', intake: { days: 7, ate: 3010, target: 2710 }, actualPct: 1.9, goalPct: 1 })).toEqual({ under: false, kcal: 300 });
    expect(intakeWarning({ type: 'surplus', intake: { days: 7, ate: 3010, target: 2710 }, actualPct: 1.2, goalPct: 1 })).toBe(null);
  });
  it('maintenance: under and losing past the steady band, or over and gaining', () => {
    expect(intakeWarning({ type: 'maintenance', intake: { days: 7, ate: 2200, target: 2500 }, actualPct: -0.35, goalPct: 0 })).toEqual({ under: true, kcal: 300 });
    expect(intakeWarning({ type: 'maintenance', intake: { days: 7, ate: 2800, target: 2500 }, actualPct: 0.35, goalPct: 0 })).toEqual({ under: false, kcal: 300 });
    expect(intakeWarning({ type: 'maintenance', intake: { days: 7, ate: 2200, target: 2500 }, actualPct: -0.2, goalPct: 0 })).toBe(null);
  });
});

describe('what counts as eaten vs target', () => {
  const rows = [{ id: 'r1', phase_id: 'phase-cut', phase_type: 'deficit', phase_name: 'Cut', start_date: '2026-09-01', end_date: null, planned_end_date: null, target_rate_pct: -0.5 }];
  const days = ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'];
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 10, 12)); });
  afterEach(() => vi.useRealTimers());
  it("the 7 days ending yesterday, fully logged days only, each against its own day's target (a refeed counts as its own)", () => {
    const planStore = { v: 2, plans: { '2026-11-03': Object.fromEntries(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => [d, { targetId: d === 'Sat' ? 'phase-weekend' : null, slots: [] }])) } };
    const r = intakeVsTarget({ today: '2026-11-10', intakeByDate: Object.fromEntries(days.map((d) => [d, 1750])), statusByDate: { '2026-11-09': false },
      presets: presets(), targetHistory: [], dietPhases: rows, planStore });
    expect(r.days).toBe(6); // Sunday unticked
    expect(Math.round(r.target)).toBe(Math.round((5 * 2050 + 3108) / 6)); // Saturday's refeed target
  });
  it('fewer than 4 logged days: nothing to judge', () => {
    expect(intakeVsTarget({ today: '2026-11-10', intakeByDate: { '2026-11-08': 1500, '2026-11-09': 1500, '2026-11-07': 1500 }, statusByDate: {},
      presets: presets(), targetHistory: [], dietPhases: rows, planStore: null })).toBe(null);
  });
});

describe('what they see', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 10, 12)); });
  afterEach(() => vi.useRealTimers());
  it('on a cut, not behind plan: the cost, and Got it', () => {
    const iso = (n) => { const d = new Date(2026, 10, 10); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    // started 14 days ago at the planned pace, then fast: on plan overall, fast lately
    const row = { id: 'r1', phase_id: 'phase-cut', phase_type: 'deficit', phase_name: 'Cut', start_date: iso(-40), end_date: null, planned_end_date: iso(44), target_rate_pct: -0.5 };
    const bw = Array.from({ length: 41 }, (_, i) => ({ date: iso(i - 40), weight: +(181 - (i < 27 ? 0.13 * i : 0.13 * 27 + 0.2 * (i - 27))).toFixed(2) }));
    const intakeByDate = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [iso(-1 - i), 1750]));
    const html = renderToStaticMarkup(React.createElement(IntakeWarning, {
      c: { today: iso(0), weekStart: iso(-1), intakeByDate, statusByDate: {} }, phase: row, presets: presets(), dietPhases: [row], bwLog: bw,
      planStore: null, targetHistory: [], onReplan: async () => {},
    })).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    expect(html).toMatch(/^EATING UNDER TARGET You ate about 300 under your target this week, and you're losing 1\.\d lb a week against a 0\.\d goal\. Losing faster costs muscle\. Got it$/);
  });
});

describe('behind plan: the ways back, open, with one way to dismiss', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 10, 12)); });
  afterEach(() => vi.useRealTimers());
  it('shows the three options straight away, and only Got it to close', () => {
    const iso = (n) => { const d = new Date(2026, 10, 10); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const row = { id: 'r1', phase_id: 'phase-cut', phase_type: 'deficit', phase_name: 'Cut', start_date: iso(-40), end_date: null, planned_end_date: iso(44), target_rate_pct: -0.5 };
    // slow start, fast lately: behind plan overall
    const bw = Array.from({ length: 41 }, (_, i) => ({ date: iso(i - 40), weight: +(181 - (i < 27 ? 0.05 * i : 0.05 * 27 + 0.2 * (i - 27))).toFixed(2) }));
    const intakeByDate = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [iso(-1 - i), 1750]));
    const t = renderToStaticMarkup(React.createElement(IntakeWarning, {
      c: { today: iso(0), weekStart: iso(-1), intakeByDate, statusByDate: {} }, phase: row, presets: presets(), dietPhases: [row], bwLog: bw,
      planStore: null, targetHistory: [], onReplan: async () => {},
    })).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(t).toContain("If you're trying to catch up, pushing your end date back is easier on your muscle than eating less.");
    expect(t).toMatch(/Finish Plan Later .* Same Date, Adjusted Goal .* Same Date, Same Goal, Faster/);
    expect(t).not.toContain('not now');
    expect(t).not.toContain('Get back on plan ›');
    expect(t.trim().endsWith('Got it')).toBe(true);
  });
});

describe('calories against maintenance, in kcal', () => {
  it('cards and history say it the same way', () => {
    expect(calVsMaintenance(2050, 2500)).toBe('450 under your 2,500 maintenance');
    expect(calVsMaintenance(2710, 2500)).toBe('210 over your 2,500 maintenance');
    expect(calVsMaintenance(2505, 2500)).toBe('your maintenance');
    expect(calVsMaintenance(2050, 2500, { short: true })).toBe('450 under maintenance'); // Phase History
    expect(calVsMaintenance(2050, null)).toBe(null);
  });
});
