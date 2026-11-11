// The weight log: date-keyed writes, weekly counts and averages from real
// weigh-ins only, and the screen's and header button's states. Real
// functions and components from App.jsx (server-rendered).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { weeksBack, weightWeeks, WeightLog, WeightButton, Settings, upsertWeighIn, withoutWeighIn, parseWeighIn, weighInOps, sbLogBodyweight, sbDeleteBodyweight } from '../src/App.jsx';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 7, 9)); }); // Sat, Nov 7, 9am local
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const TODAY = '2026-11-07';
const text = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
// Oct 26–Nov 1: 3 weigh-ins (avg 178.0). Nov 2–8 so far: Mon, Tue, Thu, Fri (no Wed)
const bw = [
  ['2026-10-26', 178.4], ['2026-10-28', 178.0], ['2026-10-31', 177.6],
  ['2026-11-02', 177.6], ['2026-11-03', 177.0], ['2026-11-05', 178.0], ['2026-11-06', 176.8],
].map(([date, weight]) => ({ date, weight }));
const withToday = upsertWeighIn(bw, TODAY, 176.6);
const session = { user: { id: 'u1', email: 'lifter@example.com' }, access_token: 't' };

describe('writes go to the date picked', () => {
  it('sbLogBodyweight upserts that date (one row per user and date)', async () => {
    const fetch = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    await sbLogBodyweight(session, 177.2, '2026-11-04');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain('bodyweight_log?on_conflict=user_id,date');
    expect(init.headers.Prefer).toBe('resolution=merge-duplicates');
    expect(JSON.parse(init.body)).toEqual({ user_id: 'u1', date: '2026-11-04', weight: 177.2 });
  });
  it('without a date it is today, the local calendar date', async () => {
    vi.setSystemTime(new Date(2026, 10, 7, 23, 59)); // 11:59pm local is still Nov 7
    const fetch = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    await sbLogBodyweight(session, 176.6);
    expect(JSON.parse(fetch.mock.calls[0][1].body).date).toBe('2026-11-07');
  });
  it('sbDeleteBodyweight removes only that user and date', async () => {
    const fetch = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    await sbDeleteBodyweight(session, '2026-11-04');
    expect(fetch.mock.calls[0][0]).toContain('user_id=eq.u1&date=eq.2026-11-04');
    expect(fetch.mock.calls[0][1].method).toBe('DELETE');
  });
  it('a past-date edit leaves today alone; a repeat save replaces, never duplicates', () => {
    const edited = upsertWeighIn(withToday, '2026-11-03', 177.4);
    expect(edited.find((r) => r.date === TODAY).weight).toBe(176.6);
    expect(edited.find((r) => r.date === '2026-11-03').weight).toBe(177.4);
    const twice = upsertWeighIn(upsertWeighIn(withToday, '2026-11-04', 177.1), '2026-11-04', 177.3);
    expect(twice.filter((r) => r.date === '2026-11-04')).toEqual([{ date: '2026-11-04', weight: 177.3 }]);
    expect(twice.map((r) => r.date)).toEqual([...twice.map((r) => r.date)].sort());
    expect(withoutWeighIn(withToday, '2026-11-03').some((r) => r.date === '2026-11-03')).toBe(false);
  });
  it('weighInOps: the log changes only after the server says yes', async () => {
    let log = withToday;
    const setBwLog = (fn) => { log = fn(log); };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    const fail = await weighInOps(session, setBwLog).save('2026-11-04', 177.1);
    expect(fail.ok).toBe(false);
    expect(log).toBe(withToday);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
    expect((await weighInOps(session, setBwLog).save('2026-11-04', 177.1)).ok).toBe(true);
    expect(log.find((r) => r.date === '2026-11-04').weight).toBe(177.1);
    expect(log.find((r) => r.date === TODAY).weight).toBe(176.6);
  });
  it('parseWeighIn: positive pounds, to a tenth; blanks, zero and typos refused', () => {
    expect(parseWeighIn('176.64')).toEqual({ weight: 176.6 });
    expect(parseWeighIn('').error).toBeTruthy();
    expect(parseWeighIn('0').error).toBeTruthy();
    expect(parseWeighIn('-5').error).toBeTruthy();
    expect(parseWeighIn('abc').error).toBeTruthy();
    expect(parseWeighIn('1766').error).toMatch(/typo/);
  });
});

describe('weightWeeks', () => {
  it('weeks newest first, elapsed days only, newest day first', () => {
    const weeks = weightWeeks(bw, TODAY);
    expect(weeks.map((w) => w.monday)).toEqual(['2026-11-02', '2026-10-26']);
    expect(weeks[0].days.map((d) => d.date)).toEqual(['2026-11-07', '2026-11-06', '2026-11-05', '2026-11-04', '2026-11-03', '2026-11-02']);
    expect(weeks[0].partial).toBe(true);
  });
  it('count and average from real weigh-ins only; today counts once logged', () => {
    const [now, last] = weightWeeks(bw, TODAY);
    expect(last).toMatchObject({ count: 3, partial: false });
    expect(last.avg).toBeCloseTo(178.0, 5);
    expect(now.count).toBe(4);
    expect(now.avg).toBeCloseTo(177.35, 5);
    const [nowT] = weightWeeks(withToday, TODAY);
    expect(nowT.count).toBe(5);
    expect(nowT.avg).toBeCloseTo(177.2, 5);
  });
  it('a jumped-to date before the first weigh-in adds its (empty) weeks', () => {
    const weeks = weightWeeks(bw, TODAY, '2026-10-14');
    expect(weeks.map((w) => w.monday)).toEqual(['2026-11-02', '2026-10-26', '2026-10-19', '2026-10-12']);
    expect(weeks[2]).toMatchObject({ count: 0, avg: null });
  });
  it('weeksBack counts Monday to Monday (Jump to date shows that many weeks)', () => {
    expect(weeksBack(TODAY, TODAY)).toBe(0);
    expect(weeksBack('2026-11-02', TODAY)).toBe(0);
    expect(weeksBack('2026-11-01', TODAY)).toBe(1);
    expect(weeksBack('2026-10-14', TODAY)).toBe(3); // a Wednesday: 19 days back, but 3 weeks
  });
  it('a future weigh-in is never counted', () => {
    expect(weightWeeks(upsertWeighIn(bw, '2026-11-08', 170), TODAY)[0].count).toBe(4);
  });
  it('no weigh-ins: no weeks', () => {
    expect(weightWeeks([], TODAY)).toEqual([]);
  });
});

describe('WeightLog screen', () => {
  const render = (props) => text(renderToStaticMarkup(React.createElement(WeightLog, {
    bwLog: bw, dietPhases: [], status: 'ready', onRetry: () => {}, onSave: async () => ({ ok: true }), onRemove: async () => ({ ok: true }), ...props,
  })));
  it('not weighed in today: says so, with Log today\'s weight first', () => {
    const t = render();
    expect(t).toContain('TODAY · SAT, NOV 7');
    expect(t).toContain('No weigh-in yet');
    expect(t.indexOf("Log today's weight")).toBeLessThan(t.indexOf('Daily log'));
  });
  it('weighed in: the weight and Edit today\'s weight', () => {
    const t = render({ bwLog: withToday });
    expect(t).toContain('176.6 lb Logged today');
    expect(t).toContain("Edit today's weight");
    expect(t).toContain('5 weigh-ins so far · 177.2 lb avg');
  });
  it('each elapsed day: its weight with Edit, or Not logged with Add; today not repeated', () => {
    const t = render();
    expect(t).toContain('Fri, Nov 6 176.8 lb Edit');
    expect(t).toContain('Wed, Nov 4 Not logged Add');
    expect(t).not.toContain('Sat, Nov 7 Not logged');
    expect(t).toContain('NOV 2 – NOV 8 4 weigh-ins so far · 177.4 lb avg');
    expect(t).toContain('OCT 26 – NOV 1 3 weigh-ins · 178.0 lb avg');
    expect(t).toContain('Jump to date');
    expect(t).toContain('Weight trend');
  });
  it('loading: nothing claims "not logged"', () => {
    const t = render({ status: 'loading' });
    expect(t).toContain("Checking today's weigh-in");
    expect(t).not.toContain('No weigh-in yet');
    expect(t).not.toContain('Not logged');
  });
  it('load failed: says so, with Retry, and no log', () => {
    const t = render({ status: 'error' });
    expect(t).toContain("Couldn't load your weigh-ins");
    expect(t).toContain('Retry');
    expect(t).not.toContain('No weigh-in yet');
    expect(t).not.toContain('Daily log');
  });
  it('no weigh-ins at all', () => {
    const t = render({ bwLog: [] });
    expect(t).toContain('No weigh-in yet');
    expect(t).toContain('No weigh-ins yet. Your log fills in');
  });
});

describe('header weight button', () => {
  const html = (props) => renderToStaticMarkup(React.createElement(WeightButton, { onClick: () => {}, ...props }));
  it('before today\'s weigh-in: the scale and a dot, no number, even with yesterday logged', () => {
    const h = html({ today: null, status: 'ready' });
    expect(h).toContain('not weighed in today');
    expect(text(h)).not.toMatch(/\d/);
  });
  it('after: today\'s weight', () => {
    expect(text(html({ today: { date: TODAY, weight: 176.6 }, status: 'ready' }))).toContain('176.6');
  });
  it('loading or failed: no dot and no "not weighed in"', () => {
    expect(html({ today: null, status: 'loading' })).toContain('checking');
    expect(html({ today: null, status: 'loading' })).not.toContain('not weighed in');
    expect(html({ today: null, status: 'error' })).toContain('load weigh-ins');
    expect(html({ today: null, status: 'error' })).not.toContain('not weighed in');
  });
});

describe('Settings', () => {
  const t = text(renderToStaticMarkup(React.createElement(Settings, {
    foods: [], phases: [], week: {}, setFoods: () => {}, setPhases: () => {}, setWeek: () => {}, debugLog: [],
    session, onBack: () => {}, onSignOut: () => {},
    onReplayTour: () => {}, onReplayTips: () => {}, onDeleteStart: () => {}, onDeleteFailed: () => {}, onAccountDeleted: () => {},
  })));
  it('sections in RepReport\'s order, sign out under Account', () => {
    const order = ['HELP', 'FEEDBACK', 'BACKUP', 'YOUR DATA', 'LEGAL', 'ACCOUNT'].map((h) => t.indexOf(h));
    expect(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1]))).toBe(true);
    expect(t.indexOf('sign out')).toBeGreaterThan(t.indexOf('ACCOUNT'));
  });
  it('the old storage wording and count boxes are gone', () => {
    expect(t).not.toContain("artifact's storage");
    expect(t).not.toContain('need verify');
  });
});
