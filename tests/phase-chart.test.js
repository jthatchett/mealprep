// The phase card's weight chart (drag the track): the past from weekly
// averages, the future from the goal rate only, both from the plan's start
// and from today (owner's design, Nov 2026). The mockup's cut: 180.0 on
// Oct 13, 0.5%/week to Jan 5, 177.7 on Nov 24 (3 lb behind).
import { describe, it, expect } from 'vitest';
import { weightChartData, weightChartReading } from '../src/App.jsx';

const row = { id: 'c', phase_type: 'deficit', phase_name: 'Cut', start_date: '2026-10-13', end_date: null, planned_end_date: '2027-01-05', target_rate_pct: -0.5 };
const wts = { start: 180.0, now: 177.7, planFrom: '2026-10-13', goalEnd: 180 * Math.pow(0.995, 85 / 7) };
const log = [['2026-10-20', 179.8], ['2026-10-27', 179.6], ['2026-11-03', 179.9], ['2026-11-10', 179.0], ['2026-11-17', 178.4], ['2026-11-24', 177.7]]
  .map(([date, weight]) => ({ date, weight }));
const c = weightChartData({ row, wts, log, today: '2026-11-24' });

describe('the phase chart', () => {
  it('past: the start, each week, today; future: weekly to the planned end', () => {
    expect(c.past.map((p) => p.date)).toEqual(['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24']);
    expect(c.future[0]).toBe('2026-12-01');
    expect(c.future[c.future.length - 1]).toBe('2027-01-05');
  });
  it('a past week: what you weighed, and where the plan had you', () => {
    expect(weightChartReading(c, '2026-11-03').head).toBe('Nov 3 · 179.9 lb · plan 177.3');
  });
  it('a future week, behind plan: at your pace and the plan, and how short of the goal at the end', () => {
    const r = weightChartReading(c, '2026-12-15');
    expect(r.head).toBe('Dec 15 · about 175.0 lb at your pace · plan 172.1');
    expect(r.sub).toBe('Jan 5 at your pace: about 172.3, 2.9 lb short of your 169.4 goal.');
  });
  it('on plan, one number and no shortfall', () => {
    const onPlan = weightChartData({ row, wts: { ...wts, now: 180 * Math.pow(0.995, 6) }, log, today: '2026-11-24' });
    const r = weightChartReading(onPlan, '2026-12-15');
    expect(r.head).toBe('Dec 15 · about 172.1 lb on plan');
    expect(r.sub).toBe(null);
  });
  it('maintenance: the weight it holds, flat', () => {
    const m = weightChartData({ row: { ...row, phase_type: 'maintenance', planned_end_date: null, target_rate_pct: 0 }, wts: { start: 162.2, now: 163.0, planFrom: '2026-10-13' }, log, today: '2026-11-24' });
    expect(weightChartReading(m, '2026-12-15').head).toBe('Dec 15 · holding 162.2 lb');
    expect(m.end).toBe('2026-12-22'); // open-ended: 4 weeks past today
  });
});
