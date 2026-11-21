// The weight verdict Meal Prep sends RepReport (weightStatus) is the phase
// card's own: same words, same level.
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { weightStatus, maintenanceHold, PhaseCard } from '../src/App.jsx';
import { presets } from './fixtures.js';

const text = (el) => renderToStaticMarkup(el).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const w = (pairs) => pairs.map(([date, weight]) => ({ date, weight }));
const OWNER = w([['2026-10-06', 160.4], ['2026-10-10', 161.8], ['2026-10-13', 162.4], ['2026-10-14', 162.6], ['2026-10-15', 162], ['2026-10-16', 162.4],
  ['2026-10-18', 161.6], ['2026-10-19', 164], ['2026-10-20', 164.4], ['2026-10-21', 163.2], ['2026-10-22', 163.2], ['2026-10-24', 163.4], ['2026-10-25', 163.2],
  ['2026-10-26', 163.2], ['2026-10-28', 163.2], ['2026-10-30', 164.4], ['2026-10-31', 164.4], ['2026-11-01', 163.4], ['2026-11-03', 163.6], ['2026-11-04', 163.2],
  ['2026-11-05', 164], ['2026-11-08', 162.4], ['2026-11-10', 162.4]]);
const maint = { id: 'm', phase_id: 'phase-maintenance', phase_type: 'maintenance', phase_name: 'Maintenance', start_date: '2026-09-09', end_date: null, planned_end_date: null, target_rate_pct: 0 };
const card = (rows, log, hold = null) => text(React.createElement(PhaseCard, { dietPhases: rows, bwLog: log, presets: presets(), week: null, estimate: null, hold, onOpenMonth: () => {}, hasRepReport: false }));

describe('weightStatus', () => {
  afterEach(() => vi.useRealTimers());
  it("maintenance: the card's 1% line, no weekly rate (the owner, Nov 10: holding 162.2, at 163.0)", () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 10, 12));
    const hold = maintenanceHold(maint, [maint], OWNER, '2026-11-10', []);
    const s = weightStatus({ dietPhases: [maint], bwLog: OWNER, today: '2026-11-10', hold });
    expect(s).toEqual({ asOf: '2026-11-10', phase: 'maintenance', level: 'ok', label: 'Holding steady', rate: '0.8 lb over 162.2', goal: 'hold your weight' });
    expect(card([maint], OWNER, hold)).toContain('● Holding steady');
  });
  it('maintenance, 1%+ off: drifting, the same as the card', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 10, 12));
    const low = [...OWNER, ...['2026-11-06', '2026-11-07', '2026-11-09'].map((date) => ({ date, weight: 159.6 }))].map((r) => (r.date >= '2026-11-04' ? { ...r, weight: 159.6 } : r));
    const hold = maintenanceHold(maint, [maint], low, '2026-11-10', []);
    const s = weightStatus({ dietPhases: [maint], bwLog: low, today: '2026-11-10', hold });
    expect(s).toMatchObject({ level: 'warn', label: 'Drifting down', rate: '2.6 lb under 162.2' });
    expect(card([maint], low, hold)).toContain('▲ Drifting down');
  });
  it('a cut on pace: the verdict, the rate and the goal, as the card shows them', () => {
    const day = (n) => { const d = new Date(2026, 10, 10); d.setDate(d.getDate() + n); return iso(d); };
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 10, 12));
    const cut = { id: 'c', phase_id: 'phase-cut', phase_type: 'deficit', phase_name: 'Cut', start_date: day(-35), end_date: null, planned_end_date: day(48), target_rate_pct: -0.5 };
    const log = Array.from({ length: 43 }, (_, i) => ({ date: day(i - 42), weight: +(163 * Math.pow(0.995, (i - 7) / 7)).toFixed(2) }));
    const s = weightStatus({ dietPhases: [cut], bwLog: log, today: day(0) });
    expect(s).toMatchObject({ phase: 'deficit', level: 'ok', label: 'On pace', rate: 'losing 0.8 lb/wk', goal: '0.8 lb/wk (0.50%)' });
    expect(card([cut], log)).toMatch(/Losing 0\.8 lb \/ week ● On pace/);
  });
  it("not enough weigh-ins: waiting, with the card's own line", () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 10, 12));
    const cut = { ...maint, id: 'c', phase_type: 'deficit', phase_name: 'Cut', start_date: '2026-10-01', planned_end_date: '2026-12-31', target_rate_pct: -0.5 };
    const log = w([['2026-11-08', 163], ['2026-11-10', 162.8]]);
    const s = weightStatus({ dietPhases: [cut], bwLog: log, today: '2026-11-10' });
    expect(s.level).toBe('waiting');
    expect(card([cut], log)).toContain(s.waitingText);
  });
  it('no phase: nothing', () => {
    expect(weightStatus({ dietPhases: [], bwLog: OWNER, today: '2026-11-10' })).toBe(null);
  });
});
