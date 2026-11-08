// The weight the phase card shows: start, now, and (cuts and bulks) where
// the goal pace puts you. The case behind it: a slow drift at maintenance
// that the 2-week pace check calls "Holding steady".
import { describe, it, expect } from 'vitest';
import { phaseWeights, paceVerdict, weightTrend } from '../src/App.jsx';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = '2026-11-08';
const day = (n) => { const d = new Date(2026, 10, 8); d.setDate(d.getDate() + n); return iso(d); };
// daily weigh-ins from `from` days ago to today, changing pctPerWeek from startLb
const log = (from, startLb, pctPerWeek) => Array.from({ length: from + 1 }, (_, i) => ({ date: day(i - from), weight: +(startLb * Math.pow(1 + pctPerWeek / 100, i / 7)).toFixed(2) }));

describe('slow drift at maintenance', () => {
  // 180 lb, maintenance for 10 weeks, losing 0.2% a week (~0.36 lb)
  const row = { id: 'm', phase_type: 'maintenance', phase_name: 'Maintenance', start_date: day(-70), planned_end_date: null, target_rate_pct: 0 };
  const bw = log(77, 180, -0.2);
  it('the 2-week pace says holding steady…', () => {
    const t = weightTrend(bw, TODAY);
    expect(paceVerdict('maintenance', t.pctPerWeek, 0).text).toBe('Holding steady');
  });
  it('…while the change since the start shows 3.6 lb gone', () => {
    const w = phaseWeights(row, bw, TODAY);
    expect(w.start.toFixed(1)).toBe('179.8'); // the week up to the start
    expect(w.now.toFixed(1)).toBe('176.2');   // the last 7 days
    expect(w.change.toFixed(1)).toBe('-3.6');
    expect(w.planNow).toBe(null);
  });
});

describe('a cut: start, now, where the plan puts you, the goal at the end', () => {
  const row = { id: 'c', phase_type: 'deficit', phase_name: 'Cut', start_date: day(-35), planned_end_date: day(-35 + 83), target_rate_pct: -0.5 };
  it('losing slower than planned shows as behind', () => {
    const w = phaseWeights(row, log(42, 181, -0.3), TODAY);
    expect(w.start.toFixed(1)).toBe('180.7');
    expect(w.planNow.toFixed(1)).toBe('176.2'); // 5 weeks at −0.5% from 180.7
    expect(w.now.toFixed(1)).toBe('178.0');
    expect(w.goalEnd.toFixed(1)).toBe('170.1'); // 12 weeks at −0.5%
    expect(w.now - w.planNow).toBeGreaterThan(0); // heavier than plan on a cut: behind
  });
  it('no weigh-ins: nothing to show', () => {
    expect(phaseWeights(row, [], TODAY)).toEqual({ start: null, now: null, change: null });
  });
});
