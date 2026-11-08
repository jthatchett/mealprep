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
    expect(t).toMatch(/CURRENT PHASE ACTIVE CUT · WEEK 6 \/ 12 Oct 1 – Dec 23 · 7 weeks left/);
    // no weigh-ins: the goal in pounds, and when the actual pace will show
    expect(t).toMatch(/GOAL Lose 0\.9 lb \/ week Your actual pace shows after 2 weeks with 4\+ weigh-ins each\./);
    expect(t).toMatch(/2,250 kcal \/ day goal −0\.50% \/ wk of bodyweight/);
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
    expect(t).toMatch(/YOUR WEIGHT, LAST 2 WEEKS Losing 0\.7 lb \/ week ● On pace · goal 0\.9 lb \/ week/);
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
    expect(t).toMatch(/Cut ACTIVE GOAL −0\.50% \/ week ✎ 2,250 kcal \/ day 165P · 70F · 240C/);
    expect(t).toMatch(/Mini-cut PRESET GOAL −0\.60% \/ week ✎ 1,770 kcal \/ day 165P · 70F · 120C At your estimate: 1,960 \(not applied\)/);
    expect(t).toMatch(/Bulk PRESET PLANNED JAN 11 GOAL \+1\.00% \/ month ✎ 2,707 kcal/);
    expect(t).toMatch(/Weekend\/Refeed ONE-DAY TARGET 3,108 kcal/);
    expect(t).toContain("Mini-cut doesn't match this estimate yet. Update it");
    expect(t).toMatch(/REPREPORT Training set ceilings −5%/); // planned −0.5%/wk, halfway through the cut
  });
});

describe('target editor', () => {
  it('the cut in effect: rate field, applied calories, the way to the calculated number, live fat minimum', () => {
    const t = text(render({ initialEdit: { id: 'phase-cut', focus: 'rate' } }));
    expect(t).toMatch(/PHASE TARGET Cut ACTIVE/);
    expect(t).toMatch(/Target rate WEIGHT LOSS .*% of bodyweight \/ week ≈ 0\.90 lb per week/);
    expect(t).toMatch(/CALORIE TARGET APPLIED 2,250 kcal \/ day/);
    expect(t).toContain('Your estimate and this pace give 2,050.');
    expect(t).toContain('Use 2,050 now');
    expect(t).toMatch(/Min 50 g · 20%/); // 20% of 2,250 = 50 g
    expect(t).toContain('Save goal & macros · applies today');
    expect(t).not.toMatch(/DAY CALORIES|aria-label="Calories"/);
  });
  it("a preset not in effect: calories calculated from its rate, and what saving changes", () => {
    const t = text(render({ initialEdit: { id: 'phase-minicut' } }));
    expect(t).toMatch(/CALORIE TARGET CALCULATED 1,960 kcal \/ day/);
    expect(t).toMatch(/maintenance 2,500 kcal \(learned\) · weight 180 lb · pace −540 kcal\/day/);
    expect(t).toMatch(/What saving changes Calories 1,770 → 1,960 · Carbs 120 → 168 g/);
    expect(t).toContain('The default for new Mini-cut phases.');
  });
  it('a planned phase keeps its own rate', () => {
    expect(text(render({ initialEdit: { id: 'phase-bulk' } }))).toContain('Already planned: Jan 11 at +1.30% / month — each keeps its own rate');
  });
  it('a refeed: day calories set directly, compared with maintenance, no weekly goal', () => {
    const t = text(render({ initialEdit: { id: 'phase-weekend' } }));
    expect(t).toMatch(/ONE-DAY TARGET Weekend\/Refeed DAY OVERRIDE/);
    expect(t).not.toMatch(/Target rate/);
    expect(t).toContain("That's +608 kcal vs your 2,500 maintenance estimate (+24%).");
    expect(t).toMatch(/Min 70 g · 20%/);
  });
});
