// The Phases tab and target editor, server-rendered (the real components):
// what's saved, applied, calculated and proposed is labeled as such.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Phases } from '../src/App.jsx';
import { presets } from './fixtures.js';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 8, 12)); });
afterEach(() => vi.useRealTimers());

// a cut in effect at −0.5%/week, kept at 2,250 at the Nov 2 check-in; the
// learned estimate is 2,500; a bulk is planned for December
const cutRow = { id: 'r1', phase_id: 'phase-cut', phase_type: 'deficit', phase_name: 'Cut', start_date: '2026-10-01', end_date: null, planned_end_date: '2026-12-23', target_rate_pct: -0.5 };
const bulkRow = { id: 'r2', phase_id: 'phase-bulk', phase_type: 'surplus', phase_name: 'Bulk', start_date: '2027-01-11', end_date: null, planned_end_date: null, target_rate_pct: 0.3 };
const list = () => presets().map((p) => (p.id === 'phase-cut' ? { ...p, target: { p: 165, f: 70, c: 240, cal: 2250 } } : p));
const coaching = (over = {}) => ({
  basis: { kcal: 2500, source: 'learned', asOf: '2026-11-02' }, weightLb: 180, due: false, grounded: true,
  thisWeek: null, last: { week_start: '2026-11-02', action: 'keep' }, ...over,
});
const render = (props = {}) => renderToStaticMarkup(React.createElement(Phases, {
  phases: list(), setPhases: () => {}, dietPhase: cutRow, dietPhases: [cutRow, bulkRow], bwLog: [], targetHistory: [],
  coaching: coaching(), training: null, week: null, onSavePreset: () => {}, onSaveActive: async () => true,
  onSwitchPhase: () => {}, onOpenCalendar: () => {}, onOpenCalc: () => {}, ...props,
})).replace(/<!-- -->/g, '');
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

describe('Phases tab', () => {
  it('the phase in effect: applied calories, its own rate, and why it differs from the calculation', () => {
    const t = text(render());
    expect(t).toMatch(/CURRENT PHASE ACTIVE CUT · WEEK 6 \/ 12 Oct 1 – Dec 23 GOAL/); // no "weeks left"
    // no weigh-ins: the goal in pounds, and when the actual pace will show
    expect(t).toMatch(/GOAL Lose 0\.9 lb \/ week 0\.50% of bodyweight a week Your pace shows once you have 2 weeks with 4\+ weigh-ins each \(0\/4 this week\)\./);
    expect(t).toMatch(/2,250 kcal \/ day · 250 under your 2,500 maintenance Eating/); // same line as the Plan card
    expect(t).toContain('Eating 2,250 kcal; your maintenance and this goal point to 2,050. You chose Keep at the Nov 2 check-in, so this target stayed as it was.');
    expect(t).not.toContain('default rate');
  });
  it('with weigh-ins: what the scale is doing, in pounds, against the goal', () => {
    // 3 weeks of daily weigh-ins, losing 0.4%/week from 181 lb (≈0.7 lb); goal 0.5% (0.9 lb)
    const bw = Array.from({ length: 21 }, (_, i) => {
      const d = new Date(2026, 9, 19 + i);
      return { date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, weight: +(181 * (1 - 0.004 * i / 7)).toFixed(2) };
    });
    const t = text(render({ bwLog: bw }));
    expect(t).toMatch(/YOUR WEIGHT, LAST 2 WEEKS Losing 0\.7 lb \/ week ● On pace · goal 0\.9 lb \/ week \(0\.50% of bodyweight\)/);
  });
  it('the estimate and where it comes from', () => {
    const t = text(render());
    expect(t).toMatch(/MAINTENANCE ESTIMATE 2,500 kcal \/ day Learned: from your logged food and weigh-ins \(check-in Nov 2\)\./);
    expect(text(render({ coaching: coaching({ basis: { kcal: 2500, source: 'starting', asOf: null }, last: null }) })))
      .toMatch(/Starting estimate: a starting estimate \(your Maintenance target\), until your data takes over\. Your data takes over at a check-in once the last 21 days have 10 fully logged days and 8 weigh-ins\./);
    expect(text(render({ coaching: coaching({ basis: null }) }))).toMatch(/None yet: your targets are example numbers/);
  });
  it("a due check-in's new estimate is shown as proposed, not applied", () => {
    const t = text(render({ coaching: coaching({ due: true, estimate: 2560, raw: { raw: 2700 } }) }));
    expect(t).toContain("This week's check-in would move it to 2,560 kcal. Not applied until you finish the check-in on Plan.");
    expect(t).toMatch(/MAINTENANCE ESTIMATE 2,500/);
  });
  it('cards: rates per week (cuts) and per month (bulks), a one-day target, planned and active', () => {
    const t = text(render());
    expect(t).toMatch(/Phase Targets Cut ACTIVE Lose 0\.9 lb\/wk ✎ 2,250 kcal \/ day 165P · 70F · 240C/);
    expect(t).toMatch(/Mini-cut Lose 1\.1 lb\/wk ✎ 1,770 kcal \/ day 165P · 70F · 120C View/);
    expect(t).toMatch(/Maintenance Hold your weight 2,500 kcal/);
    expect(t).toMatch(/Bulk PLANNED JAN 11 Gain 1\.8 lb\/mo ✎ 2,707 kcal/);
    expect(t).toMatch(/Weekend\/\u200BRefeed One day 3,108 kcal/);
    expect(t).not.toMatch(/PRESET|not applied|Cuts, bulks and maintenance follow/);
    expect(t).not.toMatch(/doesn't match this estimate|Update to/);
    expect(t).toMatch(/REPREPORT Training set ceilings −5%/); // planned −0.5%/wk, halfway through the cut
  });
});

describe('target editor', () => {
  it('the cut in effect: goal in pounds with steppers, calories, balanced macros, nothing extra', () => {
    const t = text(render({ initialEdit: { id: 'phase-cut', focus: 'rate' } }));
    expect(t).toMatch(/Cut ACTIVE ⋯ GOAL Lose 0\.9 lb \/ week − \+ % of bodyweight \/ week CALORIES 2,250 kcal \/ day/);
    expect(t).toContain('Your maintenance points to 2,050. Use 2,050');
    expect(t).toContain('Maintenance 2,500 kcal · this goal is 450 kcal/day under it.');
    expect(t).toMatch(/Protein Adjusts carbs Fat Min 50 g \(20%\) Carbs Adjusts fat/); // 20% of 2,250 = 50 g
    expect(t).toContain('Save · applies today');
    for (const gone of ['What saving changes', 'research range', 'RepReport reads it', 'APPLIED', 'CALCULATED', 'Fat minimum: 20% of this', 'Name']) expect(t).not.toContain(gone);
  });
  it('a preset not in effect: the calories it would move to, macros showing what they were', () => {
    const t = text(render({ initialEdit: { id: 'phase-minicut' } }));
    expect(t).toMatch(/GOAL Lose 1\.1 lb \/ week/); // 0.60% of 180 lb
    expect(t).toMatch(/CALORIES 1,770 → 1,960 kcal \/ day/);
    expect(t).toMatch(/Carbs was 120 g/);
    expect(t).toMatch(/ Save( |$)/);
  });
  it('the −/+ stepper moves a cut 0.1% a week and a bulk 0.25% a month', () => {
    const raw = (id) => renderToStaticMarkup(React.createElement(Phases, {
      phases: list(), setPhases: () => {}, dietPhase: cutRow, dietPhases: [cutRow, bulkRow], bwLog: [], targetHistory: [],
      coaching: coaching(), onSavePreset: () => {}, onSaveActive: async () => true, onSwitchPhase: () => {}, onOpenCalendar: () => {}, onOpenCalc: () => {},
      initialEdit: { id },
    }));
    expect(raw('phase-cut')).toContain('aria-label="Faster: +0.1%"');
    expect(raw('phase-bulk')).toContain('aria-label="Faster: +0.25%"');
  });
  it('a planned phase keeps its own rate', () => {
    expect(text(render({ initialEdit: { id: 'phase-bulk' } }))).toContain('Already planned: Jan 11 at +1.30% / month. Those keep their own rate.');
  });
  it('a refeed: day calories set directly, compared with maintenance, no goal', () => {
    const t = text(render({ initialEdit: { id: 'phase-weekend' } }));
    expect(t).toMatch(/Weekend\/Refeed ONE DAY/);
    expect(t).not.toMatch(/GOAL/);
    expect(t).toContain('CALORIES FOR THE DAY');
    expect(t).toContain('+608 kcal vs your 2,500 maintenance (+24%).');
    expect(t).toMatch(/Min 70 g \(20%\)/);
  });
});
