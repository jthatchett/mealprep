// Macro editing inside a fixed calorie target: the 20% fat minimum, the
// three balancing directions, rounding, and conflicts that block a save.
// Real functions from src/App.jsx.
import { describe, it, expect } from 'vitest';
import { fatMinG, macroKcal, balanceMacros, checkMacros, fitMacros, MACRO_KCAL_TOLERANCE } from '../src/App.jsx';

const START = { p: 165, f: 70, c: 190 }; // 660 + 630 + 760 = 2,050 kcal

describe('fat minimum: 20% of calories, rounded up to a whole gram', () => {
  it('matches the agreed examples', () => {
    expect(fatMinG(2050)).toBe(46);
    expect(fatMinG(2250)).toBe(50); // exactly 20%, no extra gram from floating point
    expect(fatMinG(2000)).toBe(45); // 44 g would be 19.8%
    expect(fatMinG(3106)).toBe(70); // a one-day target too
  });
  it('never lands under 20%, and is never a gram more than needed, from 800 to 6,000 kcal', () => {
    for (let cal = 800; cal <= 6000; cal++) {
      const g = fatMinG(cal);
      expect(9 * g).toBeGreaterThanOrEqual(0.2 * cal - 1e-9);
      expect(9 * (g - 1)).toBeLessThan(0.2 * cal);
    }
  });
  it('a 2,000 kcal target refuses 44 g of fat and accepts 45 g', () => {
    const at44 = checkMacros(balanceMacros({ p: 150, f: 60, c: 200 }, 'f', 44, 2000), 2000);
    expect(at44.ok).toBe(false);
    expect(at44.errors[0]).toMatch(/under its 45 g minimum/);
    expect(checkMacros(balanceMacros({ p: 150, f: 60, c: 200 }, 'f', 45, 2000), 2000).ok).toBe(true);
  });
});

describe('balancing keeps the calorie target', () => {
  it('the starting split totals 2,050', () => {
    expect(macroKcal(START)).toBe(2050);
    expect(checkMacros(START, 2050).ok).toBe(true);
  });
  it('fat 70 → 74 moves carbs 190 → 181; protein and calories stay', () => {
    const t = balanceMacros(START, 'f', 74, 2050);
    expect(t).toEqual({ p: 165, f: 74, c: 181 });
    expect(macroKcal(t)).toBe(2050);
  });
  it('carbs 190 → 199 moves fat 70 → 66', () => {
    const t = balanceMacros(START, 'c', 199, 2050);
    expect(t).toEqual({ p: 165, f: 66, c: 199 });
    expect(macroKcal(t)).toBe(2050);
  });
  it('protein 165 → 175 moves carbs 190 → 180', () => {
    const t = balanceMacros(START, 'p', 175, 2050);
    expect(t).toEqual({ p: 175, f: 70, c: 180 });
    expect(macroKcal(t)).toBe(2050);
  });
  it("whole grams can't always land exactly: within half a gram of the balancing macro", () => {
    // 1 g of fat is 9 kcal = 2.25 g of carbs, so carbs round
    const t = balanceMacros(START, 'f', 71, 2050);
    expect(t).toEqual({ p: 165, f: 71, c: 188 });
    expect(macroKcal(t)).toBe(2051); // 660 + 639 + 752
    expect(checkMacros(t, 2050).ok).toBe(true);
    // every edit in range stays within ±4.5 kcal (±2 when carbs balance)
    for (const field of ['p', 'f', 'c']) {
      for (let v = 0; v <= 300; v++) {
        const b = balanceMacros(START, field, v, 2050);
        const r = checkMacros(b, 2050);
        if (r.ok) expect(Math.abs(r.total - 2050)).toBeLessThanOrEqual(field === 'c' ? MACRO_KCAL_TOLERANCE : 2);
      }
    }
  });
  it('edits never drift: going back to the start gives the start', () => {
    let t = balanceMacros(START, 'f', 74, 2050);
    t = balanceMacros(t, 'c', 150, 2050);
    t = balanceMacros(t, 'c', 190, 2050);
    expect(t).toEqual(START);
  });
});

describe('limits and conflicts block saving, with the way out', () => {
  it('carbs high enough to push fat under its minimum', () => {
    const t = balanceMacros(START, 'c', 246, 2050); // fat would be 45 g
    const r = checkMacros(t, 2050);
    expect(t.f).toBe(45);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toBe('Fat would be 45 g, under its 46 g minimum (20% of 2,050 kcal). With protein at 165 g, carbs can be 245 g at most.');
    // and 245 really is the most that saves
    expect(checkMacros(balanceMacros(START, 'c', 245, 2050), 2050).ok).toBe(true);
  });
  it('fat typed under its minimum', () => {
    const r = checkMacros(balanceMacros(START, 'f', 40, 2050), 2050);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/^Fat would be 40 g, under its 46 g minimum/);
  });
  it('protein and fat over the calories: carbs would go below 0', () => {
    const t = balanceMacros(START, 'p', 400, 2050);
    expect(t.c).toBeLessThan(0);
    const r = checkMacros(t, 2050);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toBe('Protein 400 g and fat 70 g already come to 2,230 kcal, over the 2,050 kcal target, so carbs would be below 0. Lower fat to 50 g or less, or protein to 355 g or less.');
    expect(checkMacros(balanceMacros(START, 'p', 355, 2050), 2050).ok).toBe(true);
    expect(checkMacros(balanceMacros(START, 'p', 356, 2050), 2050).ok).toBe(false);
  });
  it('protein so high that even minimum fat leaves no room', () => {
    const r = checkMacros(balanceMacros({ p: 480, f: 46, c: 0 }, 'p', 480, 2050), 2050);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Fat can't go under its 46 g minimum, so lower protein to 409 g or less\.$/);
  });
  it('no hard protein or carb limits beyond 0; the check-in protein floor is a note only', () => {
    const r = checkMacros(balanceMacros(START, 'p', 120, 2050), 2050, { phaseType: 'deficit', weightLb: 180 });
    expect(r.ok).toBe(true);
    expect(r.notes[0]).toBe('Protein is under the 163 g (2.0 g/kg) the weekly check-in raises it to on a cut. You can still save it.');
  });
});

describe('new calories: protein and fat stay, carbs take it', () => {
  it('a slower cut (+180 kcal) adds carbs only', () => {
    expect(fitMacros(START, 2230)).toMatchObject({ p: 165, f: 70, c: 235, cal: 2230, fatRaised: false });
  });
  it('fat rises to a higher minimum when calories rise past it', () => {
    const t = fitMacros({ p: 165, f: 46, c: 190 }, 2600);
    expect(t).toMatchObject({ p: 165, f: 58, fatRaised: true, cal: 2600 }); // 20% of 2,600 = 57.8 g
    expect(Math.abs(macroKcal(t) - 2600)).toBeLessThanOrEqual(2);
  });
});
