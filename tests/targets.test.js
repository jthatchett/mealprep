// Saved targets follow the maintenance estimate; check-ins keep Use / Edit /
// Keep; a phase that starts gets a fresh target at its own rate; rate edits;
// refeeds; the no-estimate fallback; history. Real functions from src/App.jsx.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  realignPresets, checkinOutcome, phaseStartUpdate, shiftForRate, phaseCalTarget, presetRatePct, estimateBasis,
  checkPhaseRate, presetsAsOf, buildProteinStatus, macroKcal, phaseRatePct,
} from '../src/App.jsx';
import { presets, byId } from './fixtures.js';

afterEach(() => vi.useRealTimers());
const W = 180;

describe('calories from a rate', () => {
  it('estimate + what the pace needs, to the nearest 10', () => {
    expect(phaseCalTarget(2500, -0.5, W)).toBe(2050);
    expect(phaseCalTarget(2500, -0.7, W)).toBe(1870);
    expect(phaseCalTarget(2500, 1 / (30.44 / 7), W)).toBe(2710); // +1%/month
    expect(phaseCalTarget(2500, 0, null)).toBe(2500);            // maintenance needs no weight
  });
  it('no estimate, or a pace with no weight: nothing to calculate', () => {
    expect(phaseCalTarget(null, -0.5, W)).toBe(null);
    expect(phaseCalTarget(2500, -0.5, null)).toBe(null);
  });
  it("a preset's default rate: its own, else the phase type's", () => {
    expect(presetRatePct(byId(presets(), 'phase-cut'))).toBe(-0.7);
    expect(presetRatePct(byId(presets(), 'phase-minicut'))).toBe(-0.6);
    expect(presetRatePct(byId(presets(), 'phase-weekend'))).toBe(0);
  });
});

describe('a new learned estimate updates presets not in effect', () => {
  const run = () => realignPresets(presets(), { estimate: 2600, weightLb: W, skipIds: ['phase-maintenance'], date: '2026-11-09' });
  it('each at its own unchanged rate; protein and fat stay, carbs take it', () => {
    const next = run();
    expect(byId(next, 'phase-cut').target).toEqual({ p: 165, f: 70, c: 170, cal: 1970 });     // 2,600 − 630
    expect(byId(next, 'phase-minicut').target).toEqual({ p: 165, f: 70, c: 193, cal: 2060 }); // 2,600 − 540 (−0.6%/wk kept); 192.5 g rounds up
    expect(byId(next, 'phase-bulk').target).toEqual({ p: 145, f: 75, c: 389, cal: 2810 });    // 2,600 + 207
    expect(presetRatePct(byId(next, 'phase-minicut'))).toBe(-0.6);
    expect(byId(next, 'phase-cut').rate_pct).toBeUndefined(); // still "the default", not pinned
  });
  it('records what changed, so the card can show it', () => {
    expect(byId(run(), 'phase-cut').fit).toMatchObject({ date: '2026-11-09', reason: 'estimate', estimate: 2600, ratePct: -0.7, from: { cal: 2050 } });
  });
  it('leaves the target in effect and day targets (refeeds) alone', () => {
    const next = run();
    expect(byId(next, 'phase-maintenance')).toEqual(byId(presets(), 'phase-maintenance'));
    expect(byId(next, 'phase-weekend')).toEqual(byId(presets(), 'phase-weekend'));
  });
  it('calorie totals match the targets within whole-gram rounding', () => {
    for (const p of run()) expect(Math.abs(macroKcal(p.target) - p.target.cal)).toBeLessThanOrEqual(2);
  });
  it('no estimate: nothing changes (same array back)', () => {
    const list = presets();
    expect(realignPresets(list, { estimate: null, weightLb: W })).toBe(list);
  });
});

describe('weekly check-in: Use, Edit, Keep', () => {
  // the cut is in effect at 2,050; the estimate moved 2,500 → 2,560 from your data
  const c = {
    followed: byId(presets(), 'phase-cut'), estimate: 2560, ratePct: -0.5, weightLb: W, grounded: true,
    suggestion: { p: 165, f: 70, c: 205, cal: 2110 },
  };
  const outcome = (action, chosen = null, cc = c) => checkinOutcome({ action, chosen, c: cc, presets: presets(), date: '2026-11-09' });

  it('Keep: the target in effect stays exactly; the others follow the new estimate', () => {
    const r = outcome('keep');
    expect(r.action).toBe('keep');
    expect(r.estimate).toBe(2560);
    expect(byId(r.presets, 'phase-cut')).toEqual(byId(presets(), 'phase-cut'));
    expect(byId(r.presets, 'phase-bulk').target.cal).toBe(2770);        // 2,560 + 207
    expect(byId(r.presets, 'phase-maintenance').target.cal).toBe(2560);
  });
  it('Use: the suggestion becomes the target in effect', () => {
    const r = outcome('apply', c.suggestion);
    expect(byId(r.presets, 'phase-cut').target).toEqual(c.suggestion);
    expect(r.estimate).toBe(2560);
  });
  it('Edit with the suggested calories only changes the split: recorded as a Use, estimate untouched', () => {
    const r = outcome('adjust', { p: 165, f: 74, c: 196, cal: 2110 });
    expect(r.action).toBe('apply');
    expect(r.estimate).toBe(2560);
    expect(byId(r.presets, 'phase-cut').target).toEqual({ p: 165, f: 74, c: 196, cal: 2110 });
  });
  it('Edit with different calories is the Adjust: they become the estimate, less the pace', () => {
    const r = outcome('adjust', { p: 165, f: 70, c: 185, cal: 2030 });
    expect(r.action).toBe('adjust');
    expect(r.estimate).toBe(2480); // 2,030 + 450
    expect(byId(r.presets, 'phase-bulk').target.cal).toBe(2690); // the others follow 2,480
  });
  it('before the estimate rests on your data, nothing else moves', () => {
    const r = outcome('keep', null, { ...c, grounded: false, suggestion: null });
    expect(r.presets).toEqual(presets());
  });
});

describe('a phase that starts gets a fresh target at its own rate', () => {
  const rows = Object.freeze([
    Object.freeze({ id: 'r1', phase_id: 'phase-cut', phase_type: 'deficit', phase_name: 'Cut', start_date: '2026-09-01', end_date: null, planned_end_date: '2026-11-23', target_rate_pct: -0.7 }),
    Object.freeze({ id: 'r2', phase_id: 'phase-cut', phase_type: 'deficit', phase_name: 'Cut', start_date: '2026-11-24', end_date: null, planned_end_date: '2027-01-04', target_rate_pct: -0.5 }),
    Object.freeze({ id: 'r3', phase_id: 'phase-cut', phase_type: 'deficit', phase_name: 'Cut', start_date: '2027-02-01', end_date: null, planned_end_date: '2027-03-01', target_rate_pct: -1.0 }),
  ]);
  it('first run for an existing account only records where things stand', () => {
    const list = presets();
    const next = phaseStartUpdate(list, { row: rows[0], estimate: 2500, weightLb: W, date: '2026-11-08' });
    expect(byId(next, 'phase-cut').startedFor).toBe('r1');
    expect(next.filter((p) => p.id !== 'phase-cut').every((p) => p.startedFor === null)).toBe(true);
    next.forEach((p, i) => expect(p.target).toEqual(list[i].target)); // no target changed
    expect(phaseStartUpdate(next, { row: rows[0], estimate: 2500, weightLb: W })).toBe(next); // once only
  });
  it('the next cut starts at its own −0.5%/week and the latest estimate; other planned rates untouched', () => {
    const stamped = phaseStartUpdate(presets(), { row: rows[0], estimate: 2500, weightLb: W });
    const next = phaseStartUpdate(stamped, { row: rows[1], estimate: 2560, weightLb: W, date: '2026-11-24', source: 'learned' });
    const cut = byId(next, 'phase-cut');
    expect(cut.target).toEqual({ p: 165, f: 70, c: 205, cal: 2110 }); // 2,560 − 450
    expect(cut.startedFor).toBe('r2');
    expect(cut.fit).toMatchObject({ reason: 'start', ratePct: -0.5, estimate: 2560 });
    expect(presetRatePct(cut)).toBe(-0.7);         // the preset's default isn't rewritten
    expect(phaseRatePct(rows[2])).toBe(-1.0);       // the cut planned for February keeps its rate
    expect(byId(next, 'phase-bulk')).toEqual(byId(stamped, 'phase-bulk'));
  });
  it('maintenance after a cut starts at the estimate', () => {
    const stamped = phaseStartUpdate(presets(), { row: rows[0], estimate: 2500, weightLb: W });
    const m = { id: 'm1', phase_id: 'phase-maintenance', phase_type: 'maintenance', phase_name: 'Maintenance', start_date: '2026-11-24', target_rate_pct: 0 };
    expect(byId(phaseStartUpdate(stamped, { row: m, estimate: 2610, weightLb: null }), 'phase-maintenance').target).toEqual({ p: 145, f: 80, c: 328, cal: 2610 });
  });
  it('no estimate yet: the saved target is kept (and not retried every render)', () => {
    const stamped = phaseStartUpdate(presets(), { row: rows[0], estimate: 2500, weightLb: W });
    const next = phaseStartUpdate(stamped, { row: rows[1], estimate: null, weightLb: W });
    expect(byId(next, 'phase-cut').target).toEqual(byId(presets(), 'phase-cut').target);
    expect(byId(next, 'phase-cut').startedFor).toBe('r2');
  });
});

describe('rate edits on the phase in effect', () => {
  it('calories move by the pace difference, so a Keep (or a check-in step in progress) carries over', () => {
    // estimate 2,500 at −0.7 gives 1,870; you kept 2,250. Slowing to −0.5 adds 180.
    expect(shiftForRate({ cal: 2250 }, -0.7, -0.5, W)).toBe(2430);
    expect(shiftForRate({ cal: 1870 }, -0.7, -0.5, W)).toBe(2050);
  });
  it('the existing rate limits still apply', () => {
    expect(checkPhaseRate('deficit', 'Cut', -1.6).level).toBe('block');
    expect(checkPhaseRate('deficit', 'Cut', -1.1).level).toBe('warn');
    expect(checkPhaseRate('deficit', 'Mini-cut', -1.3).level).toBe('warn');
    expect(checkPhaseRate('surplus', 'Bulk', 2.5 / (30.44 / 7)).level).toBe('warn');
    expect(checkPhaseRate('surplus', 'Bulk', 4.5 / (30.44 / 7)).level).toBe('block');
    expect(checkPhaseRate('deficit', 'Cut', -0.5).level).toBe('ok');
  });
});

describe('where the estimate comes from', () => {
  const maint = byId(presets(), 'phase-maintenance');
  it('no check-in and example targets: none', () => {
    expect(estimateBasis({ checkins: [], maintenance: { ...maint, example: true } })).toBe(null);
  });
  it('no check-in: your Maintenance target, labeled a starting estimate', () => {
    expect(estimateBasis({ checkins: [], maintenance: maint })).toEqual({ kcal: 2500, source: 'starting', asOf: null });
  });
  it('the latest recorded check-in: learned from data, or your own number after an Edit', () => {
    const cks = [{ week_start: '2026-10-26', estimate: 2500, estimate_raw: 2600, action: 'apply' }, { week_start: '2026-11-02', estimate: 2530, estimate_raw: 2560, action: 'keep' }];
    expect(estimateBasis({ checkins: cks, maintenance: maint })).toEqual({ kcal: 2530, source: 'learned', asOf: '2026-11-02' });
    expect(estimateBasis({ checkins: [...cks, { week_start: '2026-11-09', estimate: 2450, estimate_raw: 2500, action: 'adjust' }], maintenance: maint }).source).toBe('adjusted');
    expect(estimateBasis({ checkins: [{ week_start: '2026-11-02', estimate: 2500, estimate_raw: null, action: 'keep' }], maintenance: maint }).source).toBe('starting');
  });
});

describe('history: past days keep the targets they had', () => {
  const history = [
    { preset_id: 'phase-cut', effective_date: '1970-01-01', p: 165, f: 70, c: 215, cal: 2150 },
    { preset_id: 'phase-cut', effective_date: '2026-11-02', p: 165, f: 70, c: 190, cal: 2050 },
  ];
  it('a date before a change sees the old target, after it the new one', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 8, 12));
    expect(byId(presetsAsOf(presets(), history, '2026-11-01'), 'phase-cut').target.cal).toBe(2150);
    expect(byId(presetsAsOf(presets(), history, '2026-11-05'), 'phase-cut').target.cal).toBe(2050);
  });
});

describe('protein summary for RepReport: refeeds and target changes', () => {
  const days = (sat) => Object.fromEntries(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => [d, { targetId: d === 'Sat' ? sat : null, slots: [] }]));
  const dates = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
  const base = {
    today: '2026-11-08', statusByDate: {},
    intakeByDate: Object.fromEntries(dates.map((d) => [d, 2000])),
    proteinByDate: Object.fromEntries(dates.map((d) => [d, 150])),
    dietPhases: [{ id: 'r1', phase_id: 'phase-cut', phase_type: 'deficit', phase_name: 'Cut', start_date: '2026-09-01', end_date: null, planned_end_date: null, target_rate_pct: -0.7 }],
  };
  it("a Saturday refeed is judged against the refeed's protein, the rest against the cut's", () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 8, 12));
    const planStore = { v: 2, plans: { '2026-11-02': days('phase-weekend') } };
    const s = buildProteinStatus({ ...base, presets: presets(), targetHistory: [], planStore });
    expect(s).toMatchObject({ daysLogged: 7, proteinAvg: 150, proteinTarget: 162 }); // (6 × 165 + 145) / 7
  });
  it('raising protein today leaves the past week judged against what it was', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 8, 12));
    const now = presets().map((p) => (p.id === 'phase-cut' ? { ...p, target: { p: 180, f: 70, c: 175, cal: 2050 } } : p));
    const history = [
      { preset_id: 'phase-cut', effective_date: '1970-01-01', p: 165, f: 70, c: 190, cal: 2050 },
      { preset_id: 'phase-cut', effective_date: '2026-11-08', p: 180, f: 70, c: 175, cal: 2050 },
    ];
    const s = buildProteinStatus({ ...base, presets: now, targetHistory: history, planStore: null });
    expect(s.proteinTarget).toBe(165);
  });
});

describe('phase targets follow maintenance automatically', async () => {
  const { alignPhaseTargets } = await import('../src/App.jsx');
  const learned = { kcal: 2500, source: 'learned' };
  const cutRow = { id: 'r1', phase_id: 'phase-cut', phase_type: 'deficit', phase_name: 'Cut', start_date: '2026-10-01', target_rate_pct: -0.5 };
  const stamped = (list) => list.map((p) => ({ ...p, startedFor: p.id === 'phase-cut' ? 'r1' : null }));
  it("a target not in use that's 50+ kcal off lines up: the mini-cut, 1,770 → 1,960", () => {
    const next = alignPhaseTargets(stamped(presets()), { row: cutRow, basis: learned, weightLb: W, date: '2026-11-09' });
    expect(byId(next, 'phase-minicut').target).toMatchObject({ p: 165, f: 70, cal: 1960 });
  });
  it('one already within 50 kcal is left alone (the bulk: 2,707 vs 2,710)', () => {
    const next = alignPhaseTargets(stamped(presets()), { row: cutRow, basis: learned, weightLb: W, date: '2026-11-09' });
    expect(byId(next, 'phase-bulk').target.cal).toBe(2707);
  });
  it('the target in use and one-day targets never change', () => {
    const list = stamped(presets()).map((p) => (p.id === 'phase-cut' ? { ...p, target: { p: 165, f: 70, c: 240, cal: 2250 } } : p));
    const next = alignPhaseTargets(list, { row: cutRow, basis: learned, weightLb: W, date: '2026-11-09' });
    expect(byId(next, 'phase-cut').target.cal).toBe(2250);
    expect(byId(next, 'phase-weekend')).toEqual(byId(list, 'phase-weekend'));
  });
  it('runs once: a second pass changes nothing (same array back)', () => {
    const once = alignPhaseTargets(stamped(presets()), { row: cutRow, basis: learned, weightLb: W, date: '2026-11-09' });
    expect(alignPhaseTargets(once, { row: cutRow, basis: learned, weightLb: W, date: '2026-11-09' })).toBe(once);
  });
  it("on a starting estimate, Maintenance isn't recalculated from itself", () => {
    const list = stamped(presets()).map((p) => (p.id === 'phase-maintenance' ? { ...p, target: { ...p.target, cal: 2520 } } : p));
    const next = alignPhaseTargets(list, { row: cutRow, basis: { kcal: 2400, source: 'starting' }, weightLb: W, date: '2026-11-09' });
    expect(byId(next, 'phase-maintenance').target.cal).toBe(2520);
  });
  it('no estimate yet: nothing moves', () => {
    const list = stamped(presets());
    expect(alignPhaseTargets(list, { row: cutRow, basis: null, weightLb: W, date: '2026-11-09' })).toBe(list);
  });
});
