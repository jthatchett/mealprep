// The weight a maintenance holds when there are no weigh-ins around its
// start (first full week of weigh-ins), or after 4+ weeks without any (the
// first full week back).
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { presets } from './fixtures.js';
import { holdStartWeight, maintenanceHold, phaseWeights, catchUpCopy, PhaseCard } from '../src/App.jsx';

const maint = (start) => ({ id: 'm', phase_type: 'maintenance', phase_name: 'Maintenance', start_date: start, end_date: null, planned_end_date: null, target_rate_pct: 0 });
const w = (pairs) => pairs.map(([date, weight]) => ({ date, weight }));

// Maintenance set up Sep 9; weigh-ins only from Oct 6 (the owner's case)
const OWNER = w([['2026-10-06', 160.4], ['2026-10-10', 161.8], ['2026-10-13', 162.4], ['2026-10-14', 162.6], ['2026-10-15', 162], ['2026-10-16', 162.4],
  ['2026-10-18', 161.6], ['2026-10-19', 164], ['2026-10-20', 164.4], ['2026-10-21', 163.2], ['2026-10-22', 163.2], ['2026-10-24', 163.4], ['2026-10-25', 163.2],
  ['2026-10-26', 163.2], ['2026-10-28', 163.2], ['2026-10-30', 164.4], ['2026-10-31', 164.4], ['2026-11-01', 163.4], ['2026-11-03', 163.6], ['2026-11-04', 163.2],
  ['2026-11-05', 164], ['2026-11-08', 162.4], ['2026-11-10', 162.4]]);

describe('the weight maintenance holds', () => {
  it('with weigh-ins around the start, the week up to it, as before', () => {
    const log = w([['2026-09-05', 170], ['2026-09-09', 172], ['2026-10-01', 171], ['2026-10-25', 171]]);
    expect(holdStartWeight(log, '2026-09-09', '2026-11-10')).toMatchObject({ start: 171, startKind: 'start', startFrom: '2026-09-09' });
  });
  it('no weigh-ins around the start: the first 7 days with 3+ weigh-ins (Oct 6–12 has only 2)', () => {
    const h = holdStartWeight(OWNER, '2026-09-09', '2026-11-10');
    expect(h).toMatchObject({ startKind: 'first-week', startFrom: '2026-10-10', startTo: '2026-10-16' });
    expect(h.start.toFixed(1)).toBe('162.2');
  });
  it('the owner: holding 162.2, 0.8 lb over (0.5%): inside the normal range, no catch-up', () => {
    const h = maintenanceHold(maint('2026-09-09'), [maint('2026-09-09')], OWNER, '2026-11-10', []);
    expect(h.anchor.toFixed(1)).toBe('162.2');
    expect(h.gapLb.toFixed(1)).toBe('0.8');
    expect(h.ratePct).toBe(0);
  });
  it('not a full week yet: no hold', () => {
    const log = w([['2026-10-06', 160.4], ['2026-10-10', 161.8]]);
    const h = holdStartWeight(log, '2026-09-09', '2026-10-11');
    expect(h).toMatchObject({ start: null, startKind: 'first-week' });
    expect(maintenanceHold(maint('2026-09-09'), [maint('2026-09-09')], log, '2026-10-11', [])).toMatchObject({ ratePct: 0 });
  });
  it('4+ weeks without weigh-ins: the old weight is dropped for the first full week back', () => {
    // held 162 in October, nothing Nov 1 – Feb 28, back at 170 in March
    const log = w([['2026-10-01', 162], ['2026-10-02', 162], ['2026-10-03', 162], ['2026-10-31', 162],
      ['2027-03-01', 170], ['2027-03-02', 170.4], ['2027-03-04', 169.6], ['2027-03-09', 170]]);
    const h = holdStartWeight(log, '2026-10-01', '2027-03-10');
    expect(h).toMatchObject({ start: 170, startKind: 'after-gap', startFrom: '2027-03-01', startTo: '2027-03-07' });
    const hold = maintenanceHold(maint('2026-10-01'), [maint('2026-10-01')], log, '2027-03-10', []);
    expect(hold.ratePct).toBe(0);
    // just back, under 3 weigh-ins: no hold yet (not the stale 162)
    expect(holdStartWeight(log.slice(0, 5), '2026-10-01', '2027-03-01')).toMatchObject({ start: null, startKind: 'after-gap' });
  });
  it('a 27-day gap is not stale', () => {
    const log = w([['2026-10-01', 162], ['2026-10-28', 165], ['2026-10-29', 165], ['2026-10-30', 165]]);
    expect(holdStartWeight(log, '2026-10-01', '2026-10-30')).toMatchObject({ start: 162, startKind: 'start' });
  });
  it('the catch-up names where the weight comes from', () => {
    const log = w([['2026-10-10', 170], ['2026-10-11', 170], ['2026-10-12', 170], ['2026-11-04', 166], ['2026-11-06', 166], ['2026-11-08', 166]]);
    const hold = maintenanceHold(maint('2026-09-09'), [maint('2026-09-09')], log, '2026-11-09', []);
    expect(hold.ratePct).toBeGreaterThan(0);
    expect(catchUpCopy(hold).context).toBe("Maintenance holds your first full week of weigh-ins (Oct 10–16): 170.0 lb. You're at 166.0 now.");
  });
  it('a cut with no weigh-ins around its start: the first full week, and the plan line runs from its middle', () => {
    const cut = { ...maint('2026-09-09'), phase_type: 'deficit', phase_name: 'Cut', target_rate_pct: -0.5, planned_end_date: '2026-12-31' };
    const p = phaseWeights(cut, OWNER, '2026-11-10');
    expect(p).toMatchObject({ startKind: 'first-week', startFrom: '2026-10-10', startTo: '2026-10-16' });
    expect(p.start.toFixed(1)).toBe('162.2');
    expect(p.weeks.toFixed(2)).toBe('4.00');                       // Oct 13 -> Nov 10
    expect(p.planNow.toFixed(1)).toBe((162.24 * Math.pow(0.995, 4)).toFixed(1));
  });
  it("a cut ignores the 4-week gap rule (it's planned from its start)", () => {
    const cut = { ...maint('2026-10-01'), phase_type: 'deficit', target_rate_pct: -0.5 };
    const log = w([['2026-10-01', 162], ['2026-11-15', 160], ['2026-11-16', 160], ['2026-11-17', 160]]);
    expect(phaseWeights(cut, log, '2026-11-17')).toMatchObject({ start: 162, startKind: 'start' });
  });
});

describe('the phase card', () => {
  afterEach(() => vi.useRealTimers());
  const text = (el) => renderToStaticMarkup(el).replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const card = (log) => text(React.createElement(PhaseCard, { dietPhases: [maint('2026-09-09')], bwLog: log, presets: presets(), week: null, estimate: null, onOpenMonth: () => {}, onReplan: async () => {}, hasRepReport: false }));
  it('shows the first full week it holds, and says where it comes from', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 10, 12));
    const t = card(OWNER);
    expect(t).toContain('Holding 162.2 lb Oct 10–16');
    expect(t).toContain('Holding your first full week of weigh-ins (Oct 10–16).');
    expect(t).toContain('Within your normal day-to-day range.');
  });
  it('a cut says where its start comes from', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 10, 12));
    const cut = { ...maint('2026-09-09'), phase_type: 'deficit', phase_name: 'Cut', target_rate_pct: -0.5, planned_end_date: '2026-12-31' };
    const t = text(React.createElement(PhaseCard, { dietPhases: [cut], bwLog: OWNER, presets: presets(), week: null, estimate: null, onOpenMonth: () => {}, onReplan: async () => {}, hasRepReport: false }));
    expect(t).toContain('Start 162.2 lb Oct 10–16');
    expect(t).toContain('Starting from your first full week of weigh-ins (Oct 10–16).');
  });
  it('before a full week, it says what it is waiting for', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 11, 12));
    expect(card(OWNER.slice(0, 2))).toContain('No weigh-ins around Sep 9: maintenance will hold your first full week of weigh-ins (3 in 7 days).');
  });
});
