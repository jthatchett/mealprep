// The phase card is Meal Prep's own; what RepReport says sits in its own
// card under it. With nothing planned after the phase, one line says so.
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PhaseCard } from '../src/App.jsx';
import { presets } from './fixtures.js';

const text = (el) => renderToStaticMarkup(el).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const maint = { id: 'm', phase_id: 'phase-maintenance', phase_type: 'maintenance', phase_name: 'Maintenance', start_date: '2026-09-09', end_date: null, planned_end_date: null, target_rate_pct: 0 };
const card = (props) => text(React.createElement(PhaseCard, { dietPhases: [maint], bwLog: [], presets: presets(), week: null, estimate: null, onOpenMonth: () => {}, onReplan: async () => {}, ...props }));
const goal = { primaryGoal: 'hypertrophy', focus: { primary: ['chest'], emphasize: [] }, mainLifts: [] };

describe('the RepReport card', () => {
  afterEach(() => vi.useRealTimers());
  const now = () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 11, 12)); };
  it('connected: its own card, after the phase card, with the block line and the volume impact', () => {
    now();
    const t = card({ hasRepReport: true, trainingActive: true, trainingGoal: goal });
    const rr = t.indexOf('FROM REPREPORT');
    expect(rr).toBeGreaterThan(t.indexOf('MAINTENANCE · WEEK'));
    expect(t.indexOf('Building muscle at maintenance: expect slow, steady gains.')).toBeGreaterThan(rr);
    expect(t.indexOf('Training volume impact')).toBeGreaterThan(rr);
    expect(t).not.toContain('(your RepReport block)');
    expect(renderToStaticMarkup(React.createElement(PhaseCard, { dietPhases: [maint], bwLog: [], presets: presets(), week: null, estimate: null, onOpenMonth: () => {}, hasRepReport: true }))).toContain('href="https://repreport.app"');
  });
  it('not connected: no RepReport card', () => {
    now();
    expect(card({ hasRepReport: false })).not.toContain('FROM REPREPORT');
  });
  it('nothing planned after the phase: "Next: nothing planned", one "plan ›", no dismissable reminder', () => {
    now();
    const t = card({ hasRepReport: false });
    expect(t).toContain('Next: nothing planned');
    expect(t.match(/plan ›/g)).toHaveLength(1);   // one way to the calendar, in the corner
    expect(t).not.toContain('Planning a bulk or cut next?');
  });
  it('something planned: the dates say what follows, and no "Next" line', () => {
    now();
    const cut = { ...maint, id: 'c', phase_id: 'phase-cut', phase_type: 'deficit', phase_name: 'Cut', start_date: '2026-11-01', planned_end_date: '2027-01-23', target_rate_pct: -0.5 };
    const after = { ...maint, id: 'm2', start_date: '2027-01-24' };
    const t = card({ dietPhases: [cut, after], hasRepReport: false });
    expect(t).toContain('Nov 1 – Jan 23 · then Maintenance');
    expect(t).not.toContain('Next: nothing planned');
  });
});
