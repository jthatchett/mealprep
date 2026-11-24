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
