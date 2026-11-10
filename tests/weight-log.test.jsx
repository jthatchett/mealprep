// The weight log, the header's weight button and Settings, server-rendered
// (the real components): weeks, averages and changes from real weigh-ins.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { weightWeeks, WeightLog, WeightButton, Settings } from '../src/App.jsx';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 10, 12)); }); // Tue, Nov 10
afterEach(() => vi.useRealTimers());

const TODAY = '2026-11-10';
const text = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
// three weeks: Oct 26–Nov 1 averages 178.0, Nov 2–8 averages 177.2 (no Wednesday), this week has Monday only
const bw = [
  ['2026-10-26', 178.4], ['2026-10-28', 178.0], ['2026-10-31', 177.6],
  ['2026-11-02', 177.6], ['2026-11-03', 177.0], ['2026-11-05', 178.0], ['2026-11-06', 176.8], ['2026-11-07', 176.6],
  ['2026-11-09', 176.9],
].map(([date, weight]) => ({ date, weight }));
const cut = { id: 'r1', phase_id: 'phase-cut', phase_type: 'deficit', phase_name: 'Cut', start_date: '2026-09-14', end_date: null, planned_end_date: '2026-12-06', target_rate_pct: -0.5 };

describe('weightWeeks', () => {
  const weeks = weightWeeks(bw, TODAY);
  it('Monday-to-Sunday weeks, newest first, back to the first weigh-in', () => {
    expect(weeks.map((w) => w.monday)).toEqual(['2026-11-09', '2026-11-02', '2026-10-26']);
    expect(weeks[1].days.map((d) => d.weight)).toEqual([177.6, 177.0, null, 178.0, 176.8, 176.6, null]);
  });
  it('averages only the days weighed in, and the change from the week before', () => {
    expect(weeks[2].avg).toBeCloseTo(178.0, 5);
    expect(weeks[1].avg).toBeCloseTo(177.2, 5);
    expect(weeks[1].change).toBeCloseTo(-0.8, 5);
    expect(weeks[2].change).toBeNull(); // nothing before it
  });
  it('no weigh-ins: no weeks', () => {
    expect(weightWeeks([], TODAY)).toEqual([]);
  });
});

describe('WeightLog', () => {
  const render = (log = bw) => text(renderToStaticMarkup(React.createElement(WeightLog, {
    bwLog: log, dietPhases: [cut], onBack: () => {}, onSave: async () => true, onRemove: async () => true,
  })));
  it('chart, then the latest 3 weeks with average and change', () => {
    const t = render();
    expect(t).toContain('LAST 8 WEEKS');
    expect(t).toContain('Nov 2 – Nov 8 avg 177.2 · −0.8 lb');
    expect(t).toContain('Oct 26 – Nov 1 avg 178.0');
    expect(t).toContain('cut'); // the chart legend names the phase it shades
  });
  it('more than 3 weeks: the rest behind "show earlier weeks"', () => {
    const t = render([{ date: '2026-10-12', weight: 179.8 }, ...bw]);
    expect(t).toContain('show earlier weeks');
    expect(t).not.toContain('Oct 12 – Oct 18');
  });
  it('no weigh-ins yet', () => {
    expect(render([])).toContain('No weigh-ins yet');
  });
});

describe('WeightButton', () => {
  it('before today\'s weigh-in: the scale and a dot, no number', () => {
    const html = renderToStaticMarkup(React.createElement(WeightButton, { today: null, onClick: () => {} }));
    expect(html).toContain('not weighed in today');
    expect(text(html)).not.toMatch(/\d/);
  });
  it('after: today\'s weight', () => {
    expect(text(renderToStaticMarkup(React.createElement(WeightButton, { today: { date: TODAY, weight: 176.6 }, onClick: () => {} })))).toContain('176.6');
  });
});

describe('Settings', () => {
  const t = text(renderToStaticMarkup(React.createElement(Settings, {
    foods: [], phases: [], week: {}, setFoods: () => {}, setPhases: () => {}, setWeek: () => {}, debugLog: [],
    session: { user: { id: 'u1', email: 'lifter@example.com' } }, onBack: () => {}, onSignOut: () => {},
    onReplayTour: () => {}, onReplayTips: () => {}, onDeleteStart: () => {}, onDeleteFailed: () => {}, onAccountDeleted: () => {},
  })));
  it('sections in RepReport\'s order, sign out under Account', () => {
    const order = ['HELP', 'FEEDBACK', 'BACKUP', 'YOUR DATA', 'LEGAL', 'ACCOUNT'].map((h) => t.indexOf(h));
    expect(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1]))).toBe(true);
    expect(t).toContain('lifter@example.com');
    expect(t.indexOf('sign out')).toBeGreaterThan(t.indexOf('ACCOUNT'));
  });
  it('the old storage wording and count boxes are gone', () => {
    expect(t).not.toContain("artifact's storage");
    expect(t).not.toContain('need verify');
    expect(t).toContain('Everything saves to your account automatically');
  });
});
