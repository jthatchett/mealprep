// A cut's or bulk's start settles once the first week's water has: the line
// through weeks 2–3 (4+ weigh-ins each), read where a week's average up to
// the start sits, replaces the week before.
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { phaseWeights, planStatus, PhaseCard } from '../src/App.jsx';
import { presets } from './fixtures.js';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n) => { const d = new Date(2026, 11, 1); d.setDate(d.getDate() + n); return iso(d); }; // day 0 = Dec 1
const noise = [0.3, -0.2, 0.1, -0.4, 0.2, 0, -0.1];
// flat 163.0 before; from Dec 1: 0.8 lb of water over days 1–5, fat at
// 0.8 lb/week; `stallFrom`: fat loss stops that day
const log = (toDay, { every = 1, stallFrom = null } = {}) => {
  const out = [];
  for (let n = -7; n <= toDay; n += every) {
    const water = n <= 0 ? 0 : Math.min(n, 5) * 0.16;
    const fatDays = n <= 0 ? 0 : stallFrom != null ? Math.min(n, stallFrom) : n;
    out.push({ date: day(n), weight: +(163 - water - (fatDays * 0.8) / 7 + noise[(n + 7) % 7]).toFixed(1) });
  }
  return out;
};
const cut = { id: 'c', phase_type: 'deficit', phase_name: 'Cut', start_date: day(0), end_date: null, planned_end_date: day(83), target_rate_pct: -0.5 };

describe('a cut settles its start after the first week', () => {
  it('weeks 1–3: the week before stands in, provisional, until Dec 22', () => {
    const w = phaseWeights(cut, log(9), day(9));
    expect(w.start.toFixed(1)).toBe('163.0');
    expect(w).toMatchObject({ provisional: true, settlesOn: day(21) });
  });
  it('Dec 22: settles at ~162.5, the water out; "ahead" becomes on plan', () => {
    const before = planStatus(cut, null, log(20), day(20));
    expect(before.behindLb).toBeLessThan(-0.4);               // looks ~0.4 lb ahead on the water
    const w = phaseWeights(cut, log(21), day(21));
    expect(w.provisional).toBeUndefined();
    expect(w).toMatchObject({ startKind: 'settled', settledOn: day(21) });
    expect(w.provisionalStart.toFixed(1)).toBe('163.0');
    expect(Math.abs(w.start - 162.54)).toBeLessThan(0.3);     // fat line at day −3: 163 − 0.8 + 3 × 0.114
    expect(Math.abs(planStatus(cut, null, log(21), day(21)).behindLb)).toBeLessThan(0.3);
  });
  it('a stall from day 28 shows as behind sooner (0.8 lb of water: ~4 days)', () => {
    const at = (n) => planStatus(cut, null, log(n, { stallFrom: 28 }), day(n)).behind;
    const firstBehind = Array.from({ length: 30 }, (_, i) => 28 + i).find(at);
    // the same stall measured from the week before (163.0): the water cushion delays it
    const cushion = Array.from({ length: 30 }, (_, i) => 28 + i).find((n) => {
      const w = phaseWeights(cut, log(n, { stallFrom: 28 }), day(n));
      const planNow = 163 * Math.pow(0.995, w.weeks);
      return w.now - planNow > Math.abs(0.005 * 163) + 1e-9;
    });
    expect(cushion - firstBehind).toBeGreaterThanOrEqual(3);
  });
  it('weeks 2–3 short of 4 weigh-ins each: stays provisional, and later weeks can settle it', () => {
    // 3 weigh-ins a week (Mon, Wed, Fri)
    const sparse = log(27).filter((r) => [0, 2, 4].includes(((new Date(r.date + 'T12:00').getDay()) + 6) % 7));
    const w = phaseWeights(cut, sparse, day(27));
    expect(w.provisional).toBe(true);
    const back = [...sparse.filter((r) => r.date < day(21)), ...log(35).filter((r) => r.date >= day(21))];
    expect(phaseWeights(cut, back, day(35)).startKind).toBe('settled');   // Dec 22 – Jan 4
  });
  it("a bulk does the same, the other way", () => {
    const bulk = { ...cut, phase_type: 'surplus', phase_name: 'Bulk', target_rate_pct: 0.25 };
    const up = log(21).map((r) => ({ ...r, weight: +(326 - r.weight).toFixed(1) })); // mirror: 163 → gaining
    const w = phaseWeights(bulk, up, day(21));
    expect(w.startKind).toBe('settled');
    expect(w.start).toBeGreaterThan(163.2);
  });
  it("doesn't settle: phases under 3 weeks, re-plans, or a start from a later first full week", () => {
    const mini = { ...cut, planned_end_date: day(13) };
    expect(phaseWeights(mini, log(13), day(13)).provisional).toBeUndefined();
    expect(planStatus(cut, { planFrom: { rowId: 'c', date: day(10) } }, log(25), day(25)).wts.startKind).not.toBe('settled');
    const late = log(30).filter((r) => r.date >= day(10));   // first weigh-in on day 10
    expect(phaseWeights(cut, late, day(30)).startKind).toBe('first-week');
  });
});

describe('the card', () => {
  afterEach(() => vi.useRealTimers());
  const text = (el) => renderToStaticMarkup(el).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const card = (n) => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 11, 1 + n, 12));
    return text(React.createElement(PhaseCard, { dietPhases: [cut], bwLog: log(n), presets: presets(), week: null, estimate: null, onOpenMonth: () => {}, onReplan: async () => {}, hasRepReport: false }));
  };
  it('provisional, and when it will settle', () => {
    const t = card(9);
    expect(t).toContain('Start 163.0 lb Dec 1 · provisional');
    expect(t).toContain("A cut's first week drops some water, so your start is refined once that settles (Dec 22).");
  });
  it('settled: where it moved, for two weeks', () => {
    const t = card(21);
    expect(t).toMatch(/Your start moved from 163\.0 to 162\.\d once the first week's water settled, so the plan leaves it out\./);
    expect(card(35)).not.toContain('Your start moved');
  });
});
