# Meal Prep

Nutrition app (React + Vite, single `src/App.jsx`, Supabase via plain `fetch`). Shares a Supabase account and project with RepReport (`jthatchett/RepReport`), the training app.

## Read first
- `docs/nutrition-rules.md`: every rule Meal Prep uses (targets, diet phases, weight trend, maintenance estimate, weekly check-in) and how it uses RepReport. Read it before changing any of that logic, and update it in the same PR as any rule change.
- RepReport's `docs/progression-rules.md`: the training side, including how diet phases shift training volume.

## Cross-app contract
- Meal Prep reads RepReport's `training_data` row only through `data.status` (`active`, `daysPerWeek`, `lastDaysPerWeek`, `deload`, `strength`, `goal`), via `sbLoadTrainingStatus`; the phase card's `strengthView` turns `strength` into what you see, and `goalCheck` turns `goal` into the goal line. RepReport writes it in `buildTrainingStatus`. Change both sides together.
- Meal Prep writes `app_data.status` for RepReport only (protein summary: `version`, `asOf`, `daysLogged`, `proteinAvg`, `proteinTarget`) in `buildProteinStatus`, saved by `sbSaveStatus` (that column only, never in `sbSaveAppData`); RepReport reads it in `sbLoadNutritionStatus`. Change both sides together.
- Logic duplicated in both apps must stay in step (listed in `docs/nutrition-rules.md`, "Logic shared with RepReport"): diet-phase resolution, the weight-trend rule, the diet-phase effect on volume ceilings, the goal check (`goalCheck`, `goalPlanCheck`), consent and account handling.

## Working conventions
- Verify with `npx vite build` and `npm test` (vitest, `tests/`). Tests import the real functions and components from `App.jsx` via its named exports (pure logic, or server-rendered with `react-dom/server`); never reimplement them.
- Targets: calories come from the rate and the maintenance estimate (`phaseCalTarget`); macros balance inside them (`balanceMacros`, `checkMacros`, `fitMacros`). Presets not in effect follow the estimate (`realignPresets`, via `checkinOutcome` and, 50+ kcal off, automatically via `alignPhaseTargets`); a phase's preset is refit once when it starts (`phaseStartUpdate`, `startedFor`).
- Explain user-facing behavior with concrete numbers, and ask before changing a coaching judgment (rates, caps, thresholds) rather than deciding it.
