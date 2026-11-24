// Facts shared with RepReport on the account (owner, Nov 2026; RepReport's
// docs/proposals/setup-goal.md): the calculator asks how long you've been
// lifting, optional, and saves it only when it's new or changed.
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TargetsCalculator } from '../src/App.jsx';
import { presets } from './fixtures.js';

const text = (el) => renderToStaticMarkup(el).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('the calculator asks how long you have been lifting', () => {
  it('after lifting days, optional, with the three answers RepReport uses', () => {
    const t = text(<TargetsCalculator presets={presets()} bwLog={[]} profile={null} training={null} onApply={() => {}} onClose={() => {}} />);
    const days = t.indexOf('Lifting days per week');
    const q = t.indexOf('How long have you been lifting consistently? (optional)');
    expect(days).toBeGreaterThan(-1);
    expect(q).toBeGreaterThan(days);
    expect(t.slice(q)).toMatch(/^How long have you been lifting consistently\? \(optional\) Under a year 1–3 years 3\+ years/);
  });
});

describe('the protein bar agrees with its number', async () => {
  const { MacroBars } = await import('../src/App.jsx');
  const target = { p: 160, f: 70, c: 250, cal: 2400 };
  it('over the protein target: green, a target tick, and how far over', () => {
    const html = renderToStaticMarkup(<MacroBars total={{ p: 183.6, f: 60, c: 200, cal: 2100 }} target={target} />);
    expect(text(<MacroBars total={{ p: 183.6, f: 60, c: 200, cal: 2100 }} target={target} />)).toContain('Protein 183.6 / 160 Target met · +24 g over');
    // protein's fill (the first bar) stays its own green at full width
    expect(html).toMatch(/width:100%;background:#46e6a0/);
    expect(html).toContain('left:87.14');
  });
  it('over on fat still reads red; under on protein has no extra line', () => {
    const html = renderToStaticMarkup(<MacroBars total={{ p: 120, f: 90, c: 200, cal: 2300 }} target={target} />);
    expect(html).toMatch(/width:100%;background:#ff5d7a/);
    expect(html).not.toContain('Target met');
  });
});
