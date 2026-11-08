// An existing account's targets (saved before this change: no startedFor,
// no rate_pct), at 180 lb. Calories are each split's exact total.
export const presets = () => [
  { id: 'phase-cut', name: 'Cut', phase_type: 'deficit', target: { p: 165, f: 70, c: 190, cal: 2050 } },
  { id: 'phase-minicut', name: 'Mini-cut', phase_type: 'deficit', target: { p: 165, f: 70, c: 120, cal: 1770 }, rate_pct: -0.6 },
  { id: 'phase-maintenance', name: 'Maintenance', phase_type: 'maintenance', target: { p: 145, f: 80, c: 300, cal: 2500 } },
  { id: 'phase-bulk', name: 'Bulk', phase_type: 'surplus', target: { p: 145, f: 75, c: 363, cal: 2707 } },
  { id: 'phase-weekend', name: 'Weekend/Refeed', phase_type: 'day', target: { p: 145, f: 80, c: 452, cal: 3108 } },
];
export const byId = (list, id) => list.find((p) => p.id === id);
// Pace at 180 lb: 1%/week of bodyweight = 1.8 lb x 3,500 kcal / 7 = 900 kcal/day
//   cut −0.7%/wk −630 · −0.5%/wk −450 · mini-cut −0.6%/wk −540 · bulk +1%/month +207
