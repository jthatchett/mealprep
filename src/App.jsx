import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";

/* ============================================================
   MEAL PREP — SPINE (Foods + Plan)
   Data model:
     FOOD (atom): component OR recipe
       - component: macros stored directly (per unit)
       - recipe: holds ingredients[] (each = {foodId, qty}),
                 yields N servings, macros = sum(ingredients)/servings
     PHASE: macro-target profile (P/F/C/cal)
     DAY: assigned phase + custom meal slots, each slot holds entries {foodId, qty}
   Persistence: Supabase (app_data table) + localStorage session cache
                + JSON export/import fallback
   ============================================================ */

const STORE_KEY = "mealprep:v1";
const SESSION_KEY = "mealprep:session";
const BW_SKIP_KEY = "mealprep:bw-skip"; // holds the date the weigh-in prompt was skipped

function bwSkippedOn(day) {
  try { return localStorage.getItem(BW_SKIP_KEY) === day; } catch { return false; }
}
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* ---------- Supabase config ---------- */
const SUPABASE_URL = "https://wydrhwlmsbcwkhcmgiss.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Ee-3RJPSBthf76B2x74aYA_SxL8S7BJ";

/* ---------- Supabase REST helpers (no SDK — plain fetch) ---------- */
async function sbAuthFetch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || data.error || "Auth error");
  return data;
}

// request a 6-digit email OTP (creates user if doesn't exist)
function sbRequestOtp(email) {
  return sbAuthFetch("otp", { email, create_user: true });
}

// verify the 6-digit code, returns { access_token, refresh_token, user }
function sbVerifyOtp(email, token) {
  return sbAuthFetch("verify", { email, token, type: "email" });
}

// refresh an expired session
function sbRefreshToken(refresh_token) {
  return sbAuthFetch("token?grant_type=refresh_token", { refresh_token });
}

// fetch the user's app_data row (updated_at is the version a save must match)
async function sbLoadAppData(session) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/app_data?select=foods,phases,week,updated_at&user_id=eq.${session.user.id}`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
    }
  );
  if (!res.ok) throw new Error("Failed to load data: " + res.status);
  const rows = await res.json();
  return rows[0] || null;
}

// thrown when the row changed on another device since this one loaded it
class SaveConflictError extends Error {
  constructor() {
    super("changed on another device");
    this.conflict = true;
  }
}

// Save the user's app_data row, but only over the version this device last
// saw (baseUpdatedAt, from the load or the previous save). The whole blob is
// written at once, so a blind upsert lets a stale device silently wipe edits
// made elsewhere. If the row has moved on, nothing is written and this
// throws SaveConflictError. baseUpdatedAt null = no row yet (new user):
// insert, which conflicts if another device created the row first.
// Returns the new updated_at to use as the base for the next save.
async function sbSaveAppData(session, data, baseUpdatedAt) {
  const body = JSON.stringify({
    user_id: session.user.id,
    foods: data.foods,
    phases: data.phases,
    week: data.week,
    updated_at: new Date().toISOString(),
  });
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  const res = baseUpdatedAt
    ? await fetch(
        `${SUPABASE_URL}/rest/v1/app_data?user_id=eq.${session.user.id}&updated_at=eq.${encodeURIComponent(baseUpdatedAt)}&select=updated_at`,
        { method: "PATCH", headers, body }
      )
    : await fetch(`${SUPABASE_URL}/rest/v1/app_data?select=updated_at`, { method: "POST", headers, body });
  if (res.status === 409) throw new SaveConflictError();
  if (!res.ok) {
    const err = await res.text();
    throw new Error("Failed to save data: " + res.status + " " + err);
  }
  const rows = await res.json();
  if (!rows.length) throw new SaveConflictError(); // PATCH matched nothing: updated_at moved on
  return rows[0].updated_at;
}

// local calendar date (not UTC) — matters near midnight
function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/* ---------- diet phases (shared with RepReport) ----------
   A diet_phases row is one block of the macro-cycle: cut / maintenance /
   surplus, with a start_date, an optional planned_end_date (set from the
   calendar), and an end_date that's only filled when a phase is actually
   closed early. The phase in effect on a date is the LATEST-starting row on
   or before it whose end_date (if any) hasn't passed — so a later phase
   simply takes over from an earlier one, and future phases can be planned
   without closing anything. RepReport resolves phases with the same rule. */
const DAY_MS = 86400000;
function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function isoOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function addDaysISO(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}
function daysBetween(fromISO, toISO) {
  return Math.round((parseISO(toISO) - parseISO(fromISO)) / DAY_MS);
}
function mondayOf(iso) {
  const d = parseISO(iso);
  return addDaysISO(iso, -((d.getDay() + 6) % 7));
}
function weekdayKey(iso) {
  return DAYS[(parseISO(iso).getDay() + 6) % 7];
}

function phaseOnDate(rows, iso) {
  const sorted = [...(rows || [])].sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
  return sorted.find((r) => r.start_date <= iso && (!r.end_date || r.end_date >= iso)) || null;
}

// "week 3 of 12" for a phase on a date (plannedWeeks null = open-ended)
function phaseProgress(row, iso) {
  if (!row) return null;
  const week = Math.floor(daysBetween(row.start_date, iso) / 7) + 1;
  const plannedWeeks = row.planned_end_date
    ? Math.max(1, Math.round((daysBetween(row.start_date, row.planned_end_date) + 1) / 7))
    : null;
  return { week, plannedWeeks, overrun: !!row.planned_end_date && iso > row.planned_end_date };
}

// default planned length by phase kind (RP-style norms, editable per phase):
// mini-cut ~4 wk, cut ~12 wk, bulk ~16 wk, maintenance open-ended
function defaultPhaseWeeks(preset) {
  if (!preset) return null;
  if (preset.phase_type === "deficit") return /mini/i.test(preset.name || "") ? 4 : 12;
  if (preset.phase_type === "surplus") return 16;
  return null;
}

/* ---------- target rate of weight change ----------
   Stored on each diet_phases row as % of bodyweight PER WEEK (negative =
   loss); null = the default for the phase type. Defaults:
     cut −0.7%/wk, mini-cut −1.0%/wk (Helms 2014: 0.5–1%/wk; Garthe 2011)
     bulk +0.75%/month (Helms, Muscle & Strength Pyramid: intermediates
          0.5–1%/month) — shown and judged per MONTH, since ~0.3 lb/wk is
          smaller than day-to-day noise
     maintenance 0, ±0.25%/wk counts as on target */
const WEEKS_PER_MONTH = 30.44 / 7;
const WEIGHT_UNIT = "lb";
function defaultRatePct(phaseType, name) {
  if (phaseType === "deficit") return /mini/i.test(name || "") ? -1.0 : -0.7;
  if (phaseType === "surplus") return 0.75 / WEEKS_PER_MONTH;
  return 0;
}
function phaseRatePct(row) {
  return row.target_rate_pct != null ? Number(row.target_rate_pct) : defaultRatePct(row.phase_type, row.phase_name);
}
// bulks are read and entered per month; cuts and maintenance per week
const rateIsMonthly = (phaseType) => phaseType === "surplus";
const roundRate = (n) => Math.round(n * 1e4) / 1e4;

const PHASE_COLORS = { deficit: "#ff8a5c", maintenance: "#7aa7ff", surplus: "#46e6a0" };

/* ---------- training volume impact (mirrors RepReport) ----------
   How much the diet phase is moving RepReport's recovery ceilings (MRV):
   the average change across muscles, as a % of each muscle's baseline.
   This is a straight port of RepReport's resolveDietPhaseContext +
   applyDietPhaseShift (src/App.jsx there) — keep the two in step. In
   short: a cut lowers each MRV toward the low end of RP's published range
   and a bulk raises it toward the high end; the shift builds with how far
   through the phase you are (planned length, else 12 weeks) and scales
   with how fast weight is actually moving (1%/wk loss or 0.5%/wk gain =
   full effect; half until a weight trend exists). Maintenance phases
   don't shift anything. Bounded by RP's ranges, so it tops out near ±17% —
   except a mini-cut, which takes ~30% off (see MINICUT_VOLUME_CUT). */
const VOLUME_MRV = {
  // muscle: [baseline MRV, RP low, RP high]
  chest: [20, 16, 24], horizontalBack: [23, 20, 26], verticalBack: [23, 20, 26],
  biceps: [23, 20, 26], triceps: [18, 16, 20], frontDelts: [10, 8, 12],
  sideDelts: [27, 24, 30], rearDelts: [16, 12, 20], traps: [16, 12, 20],
  forearms: [27, 24, 30], quads: [16, 14, 18], hamstrings: [11, 8, 14],
  glutes: [27, 24, 30], calves: [20, 16, 24], abs: [16, 12, 20],
};
const VOLUME_FULL_EFFECT_WEEKS = 12;
const VOLUME_DEFICIT_FULL_RATE = 0.01;
const VOLUME_SURPLUS_FULL_RATE = 0.005;
const VOLUME_DEFAULT_STRENGTH = 0.5;
const VOLUME_SCALE = 30; // the bar runs -30%..+30% (a mini-cut reaches -30%)

/* ---------- phase transitions ----------
   A cut's or bulk's effect on training volume doesn't stop the day the
   phase does — it fades out over the maintenance RP recommends after it,
   whatever phase actually comes next (skipping maintenance doesn't skip
   the fatigue). RP Diet 2.0: maintenance after a cut ≈ ⅔–1× the cut's
   length (⅔ used); after a bulk 2–4 wk (Israetel / McDonald — practitioner
   advice, no trial behind it; scaled by the bulk's length: up to 8 wk → 2,
   up to 16 → 3, longer → 4); none after a mini-cut, which goes
   straight back into the bulk. The same lengths are what the calendar
   suggests and auto-adds as a Maintenance phase. Back-to-back blocks of
   the same type chain: a cut that starts while the last one is still
   fading holds the effect where it stood and counts both cuts toward the
   next fade (a short maintenance between two cuts works as a diet break —
   a pause, not a reset). */
const CUT_MAINTENANCE_FRACTION = 2 / 3;
const bulkMaintenanceWeeks = (bulkWeeks) => (bulkWeeks <= 8 ? 2 : bulkWeeks <= 16 ? 3 : 4);
const isMiniCut = (type, name) => type === "deficit" && /mini/i.test(name || "");

/* Mini-cuts cut volume harder than the landmark ranges allow a regular
   cut to: ~30% off MRV and the volume target, from week 1 rather than
   building across the phase (a 2–6 wk crash phase has no time to build).
   Coaching guidance for mini-cuts puts training at ~⅔–¾ of usual volume;
   30% is the middle of that — a starting point to refine. Scaled by the
   weight trend like any phase, but assumed at full strength until a trend
   exists, since a mini-cut's target pace (~1%/wk) is the full-effect rate. */
const MINICUT_VOLUME_CUT = 0.3;
// a row's kind: deficit / surplus / maintenance, with mini-cuts their own
const phaseKind = (r) => (isMiniCut(r.phase_type, r.phase_name) ? "minicut" : r.phase_type);
const KIND_LABEL = { deficit: "cut", surplus: "bulk", minicut: "mini-cut" };

// weeks of maintenance RP suggests after a block (null = none)
function suggestedMaintenanceWeeks(type, name, blockWeeks) {
  if (type === "deficit") return isMiniCut(type, name) ? null : Math.max(1, Math.round(blockWeeks * CUT_MAINTENANCE_FRACTION));
  if (type === "surplus") return bulkMaintenanceWeeks(blockWeeks);
  return null;
}

// Rows grouped into blocks: consecutive rows of the same type are one
// block (the clock runs from the first). Each block runs until its last
// row's end_date or the day before the next block starts, whichever is
// first (end null = still running).
function phaseBlocks(rows) {
  const sorted = [...(rows || [])].sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const blocks = [];
  sorted.forEach((r, i) => {
    const next = sorted[i + 1];
    let end = r.end_date || null;
    if (next && (!end || end >= next.start_date)) end = addDaysISO(next.start_date, -1);
    const last = blocks[blocks.length - 1];
    if (last && last.kind === phaseKind(r)) { last.rows.push(r); last.end = end; }
    else blocks.push({ type: r.phase_type, kind: phaseKind(r), name: r.phase_name, start: r.start_date, end, rows: [r] });
  });
  return blocks;
}

// A block's weeks from its start to `iso` (inclusive)
const blockWeeksTo = (b, iso) => (daysBetween(b.start, iso) + 1) / 7;

// The phase's context on a date: the covering phase and its own effect
// (progress through the block × strength from the weight trend), plus
// whatever an earlier cut or bulk still leaves behind. deficit / surplus
// are the combined levels (0–1) the MRV shift uses.
function dietPhaseContext(rows, iso, bwLog) {
  const phase = phaseOnDate(rows, iso);
  if (!phase) return null;
  const strengthOn = (type, day, kind) => {
    const trend = weightTrend(bwLog, day);
    const rate = trend.ready ? trend.pctPerWeek / 100 : null;
    if (kind === "minicut") return { s: rate === null ? 1 : rate < 0 ? Math.min(1, -rate / VOLUME_DEFICIT_FULL_RATE) : 0, estimated: rate === null };
    if (type === "deficit") return { s: rate === null ? VOLUME_DEFAULT_STRENGTH : rate < 0 ? Math.min(1, -rate / VOLUME_DEFICIT_FULL_RATE) : 0, estimated: rate === null };
    if (type === "surplus") return { s: rate === null ? VOLUME_DEFAULT_STRENGTH : rate > 0 ? Math.min(1, rate / VOLUME_SURPLUS_FULL_RATE) : 0, estimated: rate === null };
    return { s: 0, estimated: rate === null };
  };
  // the block's own effect on a day inside it
  const own = (b, day) => {
    const covering = [...b.rows].reverse().filter((r) => r.start_date <= day);
    const plannedEnd = (covering.find((r) => r.planned_end_date) || {}).planned_end_date || null;
    const weeksIn = Math.max(0, daysBetween(b.start, day) / 7);
    const plannedWeeks = plannedEnd ? Math.max(1, (daysBetween(b.start, plannedEnd) + 1) / 7) : VOLUME_FULL_EFFECT_WEEKS;
    const progress = b.kind === "minicut" ? 1 : Math.min(1, weeksIn / plannedWeeks);
    const { s, estimated } = strengthOn(b.type, day, b.kind);
    return { progress, strength: s, estimated, level: progress * s };
  };
  const KINDS = ["deficit", "surplus", "minicut"];
  const carry = { deficit: null, surplus: null, minicut: null }; // { v, end, fadeDays, weeks, name }
  const residual = (c, day) => (c ? c.v * Math.max(0, 1 - daysBetween(c.end, day) / c.fadeDays) : 0);
  // a block of the same type as one still fading picks up where that one
  // stood when it started (held, not decaying) until its own effect passes it
  const held = (b, level) => Math.min(1, Math.max(residual(carry[b.kind], b.start), level));
  for (const b of phaseBlocks(rows)) {
    if (b.start > iso) break;
    const typed = KINDS.includes(b.kind);
    if (b.end === null || b.end >= iso) {
      const o = typed ? own(b, iso) : { progress: 0, strength: 0, estimated: false, level: 0 };
      const levels = Object.fromEntries(KINDS.map((k) => [k, residual(carry[k], iso)]));
      if (typed) levels[b.kind] = held(b, o.level);
      // the earlier phase still fading (the larger, if both are)
      let fading = null;
      for (const t of KINDS) {
        const c = carry[t], r = residual(c, iso);
        if (t !== b.kind && r > 0.005 && (!fading || r > fading.level)) {
          fading = { type: t, name: c.name, level: r, weeksLeft: Math.ceil((c.fadeDays - daysBetween(c.end, iso)) / 7) };
        }
      }
      return { phase, type: b.type, kind: b.kind, blockStart: b.start, progress: o.progress, strength: o.strength, estimated: o.estimated, ...levels, fading };
    }
    if (!typed) continue;
    const prev = carry[b.kind];
    const level = held(b, own(b, b.end).level);
    const weeks = blockWeeksTo(b, b.end) + (residual(prev, b.start) > 0 ? prev.weeks : 0);
    const fadeWeeks = b.kind === "surplus" ? bulkMaintenanceWeeks(weeks) : weeks * CUT_MAINTENANCE_FRACTION;
    carry[b.kind] = { v: level, end: b.end, fadeDays: Math.max(7, fadeWeeks * 7), weeks, name: b.name };
  }
  return null;
}

// Average MRV change across muscles, in % (negative = less volume).
function volumeImpactPct(ctx) {
  if (!ctx || (!ctx.deficit && !ctx.surplus && !ctx.minicut)) return 0;
  // a cut still fading under a mini-cut doesn't stack on it: the larger
  // of the two reductions applies
  const shifts = Object.values(VOLUME_MRV).map(([base, lo, hi]) =>
    (-Math.max((base - lo) * ctx.deficit, base * MINICUT_VOLUME_CUT * ctx.minicut) + (hi - base) * ctx.surplus) / base);
  return (shifts.reduce((a, b) => a + b, 0) / shifts.length) * 100;
}

// The block that ended the day before `iso` (a cut/bulk the phase starting
// that day would follow), ignoring rows in `exclude` — with its length and
// the maintenance RP suggests after it.
function precedingBlock(rows, iso, exclude = []) {
  const kept = (rows || []).filter((r) => !exclude.includes(r.id) && r.start_date < iso);
  const prevDay = addDaysISO(iso, -1);
  const b = phaseBlocks(kept).find((x) => x.start <= prevDay && (x.end === null || x.end >= prevDay));
  if (!b) return null;
  const weeks = Math.max(1, Math.round(blockWeeksTo(b, prevDay)));
  return { type: b.type, name: b.name, weeks, maintenanceWeeks: suggestedMaintenanceWeeks(b.type, b.name, weeks) };
}

const blockLabel = (b) => `${b.weeks}-wk ${isMiniCut(b.type, b.name) ? "mini-cut" : b.type === "deficit" ? "cut" : "bulk"}`;

// A one-line, never-blocking note when a phase starting on `start` skips
// or shortens the maintenance RP suggests after the block before it.
function transitionNote(rows, start, type, weeks, exclude = []) {
  const prev = precedingBlock(rows, start, exclude);
  if (!prev || !prev.maintenanceWeeks || prev.type === type) return null;
  if (type === "maintenance") {
    if (weeks && weeks < prev.maintenanceWeeks) {
      return `Suggested: ~${prev.maintenanceWeeks} wk of maintenance after a ${blockLabel(prev)}. Shorter is fine — the training effect still fades on that schedule.`;
    }
    return null;
  }
  return `Suggested: ~${prev.maintenanceWeeks} wk of maintenance after a ${blockLabel(prev)} before a ${type === "deficit" ? "cut" : "bulk"}. Your call — the training effect still fades on that schedule.`;
}

// Average daily calorie target for a phase's week (weekday overrides such
// as a Saturday refeed count), and its % against the Maintenance template.
function phaseCalories(phaseRow, presets, week) {
  const followed = presets.find((p) => p.id === phaseRow?.phase_id) || null;
  const maint = presets.find((p) => p.id === "phase-maintenance") || presets.find((p) => /maint/i.test(p.name)) || null;
  if (!followed) return null;
  const days = Object.values(week || {});
  const cals = days.length
    ? days.map((d) => (d.targetId ? presets.find((p) => p.id === d.targetId)?.target.cal : null) ?? followed.target.cal)
    : [followed.target.cal];
  const avg = cals.reduce((a, b) => a + b, 0) / cals.length;
  const pct = maint?.target.cal ? ((avg - maint.target.cal) / maint.target.cal) * 100 : null;
  return { avg, pct, baseOnly: followed.target.cal, isMaintenance: followed === maint };
}

function sbHeaders(session, extra) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}`, ...extra };
}

async function sbLoadDietPhases(session) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/diet_phases?select=id,phase_id,phase_name,phase_type,start_date,end_date,planned_end_date,target_rate_pct&user_id=eq.${session.user.id}&order=start_date.asc`,
    { headers: sbHeaders(session) }
  );
  if (!res.ok) throw new Error("Failed to load diet phases: " + res.status);
  return res.json();
}

async function sbInsertDietPhase(session, { preset, start_date, planned_end_date, target_rate_pct }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/diet_phases`, {
    method: "POST",
    headers: sbHeaders(session, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({
      user_id: session.user.id,
      phase_id: preset.id,
      phase_name: preset.name,
      phase_type: preset.phase_type,
      start_date,
      planned_end_date: planned_end_date || null,
      end_date: null,
      target_rate_pct: target_rate_pct ?? roundRate(defaultRatePct(preset.phase_type, preset.name)),
    }),
  });
  if (!res.ok) throw new Error("Failed to add phase: " + res.status);
}

async function sbUpdateDietPhase(session, id, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/diet_phases?id=eq.${id}`, {
    method: "PATCH",
    headers: sbHeaders(session, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Failed to update phase: " + res.status);
}

async function sbDeleteDietPhase(session, id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/diet_phases?id=eq.${id}`, {
    method: "DELETE",
    headers: sbHeaders(session, { Prefer: "return=minimal" }),
  });
  if (!res.ok) throw new Error("Failed to delete phase: " + res.status);
}

// The Maintenance preset a suggested maintenance phase uses
const maintenancePreset = (presets) =>
  (presets || []).find((p) => p.id === "phase-maintenance") || (presets || []).find((p) => p.phase_type === "maintenance") || null;

// After a cut or bulk with a planned end, add the maintenance RP suggests
// (see suggestedMaintenanceWeeks) starting the next day — unless something
// is already planned to start by then. It's an ordinary phase: edit or
// delete it like any other. `weeks` overrides the suggested length.
async function sbAddMaintenanceAfter(session, rows, row, presets, weeks) {
  const maint = maintenancePreset(presets);
  if (!maint || !row.planned_end_date || (row.phase_type !== "deficit" && row.phase_type !== "surplus")) return;
  const start = addDaysISO(row.planned_end_date, 1);
  const prev = precedingBlock([...(rows || []).filter((r) => r.id !== row.id), { ...row, end_date: row.planned_end_date }], start);
  const len = weeks || prev?.maintenanceWeeks;
  if (!len) return;
  const next = (rows || [])
    .filter((r) => r.id !== row.id && r.start_date > row.start_date)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0];
  if (next && next.start_date <= start) return;
  let planned = addDaysISO(start, len * 7 - 1);
  if (next && planned >= next.start_date) planned = addDaysISO(next.start_date, -1);
  await sbInsertDietPhase(session, { preset: maint, start_date: start, planned_end_date: planned });
}

// The maintenance phase planned right after `row` (start = its planned end
// + 1) that hasn't started yet — the one sbAddMaintenanceAfter added.
function followingMaintenance(rows, row) {
  if (!row?.planned_end_date) return null;
  const start = addDaysISO(row.planned_end_date, 1);
  return (rows || []).find((r) => r.phase_type === "maintenance" && r.start_date === start && r.start_date > todayISO()) || null;
}

// quick switch: the phase covering today ends and `preset` starts today.
// A phase that itself started today is changed in place instead (closing
// it "yesterday" would end it before it began). Planned phases later in
// the calendar are left alone — the new phase's planned end stops the day
// before the next one starts, else uses the default length.
async function sbSwitchDietPhase(session, preset, rows, presets) {
  const today = todayISO();
  const current = phaseOnDate(rows, today);
  // the maintenance planned after the current phase was for the plan being
  // cut short — drop it; what follows is decided below
  const stale = followingMaintenance(rows, current);
  if (stale) {
    await sbDeleteDietPhase(session, stale.id);
    rows = rows.filter((r) => r.id !== stale.id);
  }
  const next = [...(rows || [])]
    .filter((r) => r.start_date > today)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0];
  // maintenance after a cut/bulk runs the length RP suggests for the block
  // actually done; otherwise the phase's usual default
  const weeks = preset.phase_type === "maintenance"
    ? precedingBlock(rows.map((r) => (r === current && current.start_date !== today ? { ...r, end_date: addDaysISO(today, -1) } : r)), today, current?.start_date === today ? [current.id] : [])?.maintenanceWeeks || null
    : defaultPhaseWeeks(preset);
  let planned = weeks ? addDaysISO(today, weeks * 7 - 1) : null;
  if (next && (!planned || planned >= next.start_date)) planned = addDaysISO(next.start_date, -1);
  const fields = { phase_id: preset.id, phase_name: preset.name, phase_type: preset.phase_type, start_date: today, planned_end_date: planned };
  if (current && current.start_date === today) {
    await sbUpdateDietPhase(session, current.id, {
      ...fields, target_rate_pct: roundRate(defaultRatePct(preset.phase_type, preset.name)),
    });
  } else {
    if (current) await sbUpdateDietPhase(session, current.id, { end_date: addDaysISO(today, -1) });
    await sbInsertDietPhase(session, { preset, start_date: today, planned_end_date: planned });
  }
  if (!isMiniCut(preset.phase_type, preset.name)) {
    await sbAddMaintenanceAfter(session, rows.filter((r) => r !== current || current.start_date !== today), { id: null, ...fields }, presets);
  }
}

// fetch every weigh-in, oldest first — today's prompt check, the two-week
// trend, the four-week trend bulks are judged on, and Phase History
async function sbLoadRecentBodyweight(session) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/bodyweight_log?select=date,weight&user_id=eq.${session.user.id}&order=date.asc`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` } }
  );
  if (!res.ok) throw new Error("Failed to load bodyweight: " + res.status);
  return res.json();
}

/* ---------- food log (intake_log) ----------
   What was actually eaten, by date. The weekly plan is only a template;
   checking off a meal copies its foods in here with their macros PER UNIT
   as they are at that moment, so later edits to the plan or the food
   library never change what was logged. */
const INTAKE_COLS = "id,date,slot_id,slot_name,food_id,food_name,unit,qty,p,f,c,cal,source";

async function sbLoadIntake(session, date) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/intake_log?select=${INTAKE_COLS}&user_id=eq.${session.user.id}&date=eq.${date}&order=id.asc`,
    { headers: sbHeaders(session) }
  );
  if (!res.ok) throw new Error("Failed to load food log: " + res.status);
  return res.json();
}

async function sbInsertIntake(session, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/intake_log`, {
    method: "POST",
    headers: sbHeaders(session, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify(rows.map((r) => ({ ...r, user_id: session.user.id }))),
  });
  if (!res.ok) throw new Error("Failed to log food: " + res.status);
}

// filter: PostgREST query, always scoped to the user
async function sbDeleteIntake(session, filter) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/intake_log?user_id=eq.${session.user.id}&${filter}`, {
    method: "DELETE",
    headers: sbHeaders(session, { Prefer: "return=minimal" }),
  });
  if (!res.ok) throw new Error("Failed to remove from log: " + res.status);
}

async function sbUpdateIntake(session, id, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/intake_log?id=eq.${id}`, {
    method: "PATCH",
    headers: sbHeaders(session, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Failed to update log: " + res.status);
}

// a log row for `qty` of `food`, with its per-unit macros copied in now
function intakeRow(date, { slotId, slotName, food, foods, qty, source }) {
  const m = foodMacros(food, foods);
  return {
    date, slot_id: slotId || null, slot_name: slotName, food_id: food.id,
    food_name: food.name, unit: food.unit, qty, p: m.p, f: m.f, c: m.c, cal: m.cal, source,
  };
}

// macro totals for log rows (qty × per-unit macros)
function intakeTotal(rows) {
  let t = ZERO;
  for (const r of rows || []) t = addM(t, scale({ p: Number(r.p), f: Number(r.f), c: Number(r.c), cal: Number(r.cal) }, Number(r.qty)));
  return t;
}

/* ---------- weight trend ----------
   Same rule RepReport uses (computeWeeklyWeightRate): the average of the
   7 days ending today against the 7 days before, and only when each week
   has at least 4 weigh-ins — single weigh-ins swing 1–2% on water alone.
   Keep the two in step. */
const TREND_MIN_WEIGHINS = 4;
function weightTrend(log, today) {
  const week = (from, to) =>
    (log || []).filter((r) => r.date >= from && r.date <= to).map((r) => Number(r.weight)).filter((w) => w > 0);
  const recent = week(addDaysISO(today, -6), today);
  const prior = week(addDaysISO(today, -13), addDaysISO(today, -7));
  const avg = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  if (recent.length < TREND_MIN_WEIGHINS || prior.length < TREND_MIN_WEIGHINS) {
    return { ready: false, recentCount: recent.length, priorCount: prior.length };
  }
  const now = avg(recent), before = avg(prior);
  return { ready: true, avg: now, perWeek: now - before, pctPerWeek: ((now - before) / before) * 100 };
}

// Four-week version for bulks: the last 7 days against days 22–28 ago
// (window centres 21 days apart), scaled to a month. Same 4-weigh-in rule.
function monthlyWeightTrend(log, today) {
  const week = (from, to) =>
    (log || []).filter((r) => r.date >= from && r.date <= to).map((r) => Number(r.weight)).filter((w) => w > 0);
  const recent = week(addDaysISO(today, -6), today);
  const old = week(addDaysISO(today, -27), addDaysISO(today, -21));
  const avg = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  if (recent.length < TREND_MIN_WEIGHINS || old.length < TREND_MIN_WEIGHINS) {
    return { ready: false, recentCount: recent.length, oldCount: old.length };
  }
  const now = avg(recent), before = avg(old);
  const perMonth = ((now - before) / 21) * 30.44;
  return { ready: true, avg: now, perMonth, pctPerMonth: (perMonth / before) * 100 };
}

// log (or overwrite) today's bodyweight
async function sbLogBodyweight(session, weight) {
  // on_conflict targets the (user_id, date) unique key — without it PostgREST
  // merges on the primary key only, so a second save the same day 409s
  // instead of overwriting.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/bodyweight_log?on_conflict=user_id,date`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ user_id: session.user.id, date: todayISO(), weight }),
  });
  if (!res.ok) throw new Error("Failed to save bodyweight: " + res.status);
}

/* ---------- seeded data (VERIFY = best-effort macros to correct) ---------- */
// macros are PER the stated unit. verify:true means "Hayden: check this number".
const SEED_FOODS = [
  // proteins
  f("chicken breast", "oz", 7.7, 0.6, 0, 36, true),
  f("99/1 ground turkey", "oz", 6.5, 0.25, 0, 30, true),
  f("96/4 ground beef", "oz", 6.4, 0.5, 0, 34, true),
  f("93/7 ground beef", "oz", 6.0, 0.9, 0, 40, true),
  f("egg whites", "tbsp", 1.7, 0, 0.05, 8.3, true),
  f("nonfat Greek yogurt", "cup", 23, 0, 9, 130, true),
  f("low-fat cottage cheese", "cup", 28, 2.5, 8, 163, true),
  f("tuna packet", "packet", 17, 0.5, 2, 80, true),
  f("OWYN protein powder", "scoop", 20, 1, 7, 140, true),
  f("imitation crab", "oz", 2.5, 0.2, 3, 25, true),
  f("salmon fillet", "fillet", 23, 13, 0, 210, true),
  f("deli turkey", "oz", 5, 0.5, 1, 30, true),
  // carbs
  f("jasmine rice (cooked)", "cup", 4, 0.4, 45, 205, true),
  f("white rice (cooked)", "cup", 4, 0.4, 45, 205, true),
  f("brown rice (cooked)", "cup", 5, 2, 45, 215, true),
  f("quinoa (cooked)", "cup", 8, 4, 39, 222, true),
  f("rolled oats (dry)", "cup", 13, 5, 54, 307, true),
  f("rice cake", "cake", 0.5, 0, 11, 50, true),
  f("black beans", "cup", 15, 0.9, 40, 218, true),
  f("banana", "medium", 1.3, 0.4, 27, 105, false),
  f("whole wheat bread", "slice", 4, 1, 12, 80, true),
  f("keto bread", "slice", 5.5, 1.75, 9.75, 67.5, true),
  // veg
  f("broccoli", "cup", 2.6, 0.3, 6, 31, false),
  f("Brussels sprouts", "cup", 3, 0.3, 8, 38, false),
  f("Normandy blend veg", "cup", 2, 0.5, 7, 40, true),
  f("mushrooms", "oz", 0.9, 0.1, 0.9, 6, true),
  f("red onion", "oz", 0.3, 0, 2.4, 11, true),
  // fruit
  f("mixed berries", "cup", 1, 0.5, 17, 70, true),
  f("strawberries", "cup", 1, 0, 8, 45, false),
  f("apple", "medium", 0.5, 0.3, 25, 95, false),
  // fats / extras
  f("avocado", "half", 2, 15, 9, 160, false),
  f("PB2 / PB powder", "tbsp", 3, 1, 2, 30, true),
  f("olive oil", "tbsp", 0, 14, 0, 120, false),
  f("mixed nuts", "oz", 5, 14, 6, 170, true),
  // --- added for seeded recipes (all VERIFY) ---
  f("celery stalk", "stalk", 0.3, 0.1, 1.2, 6, true),
  f("honey roasted almonds", "oz", 6, 15, 6, 170, true),
  f("lite miracle whip", "tbsp", 0, 3, 2, 35, true),
  f("dijon mustard", "tbsp", 0.3, 0.2, 1, 10, true),
  f("white vinegar", "tbsp", 0, 0, 0, 3, true),
  f("garbanzo beans", "cup", 15, 4, 45, 269, true),
  f("great northern beans", "can", 21, 1, 54, 300, true),
  f("salami slice", "slice", 2, 3, 0.3, 35, true),
  f("iceberg lettuce", "head", 5, 1, 11, 50, true),
  f("cucumber", "medium", 2, 0.3, 11, 45, true),
  f("fat free mozzarella", "cup", 36, 0, 8, 160, true),
  f("parmesan cheese", "cup", 38, 28, 4, 420, true),
  f("deli turkey slice", "slice", 5, 0.5, 1, 30, true),
  f("soy sauce", "tbsp", 1, 0, 1, 10, true),
  f("cornstarch", "tbsp", 0, 0, 7, 30, true),
  f("brown sugar substitute", "tbsp", 0, 0, 0, 0, true),
  f("yellow onion", "medium", 1, 0, 11, 44, true),
  f("minced garlic", "tbsp", 0.5, 0, 3, 15, true),
  f("diced tomatoes", "can", 4, 0, 18, 80, true),
  f("fat free half and half", "cup", 8, 0, 28, 160, true),
  f("Pace salsa", "cup", 2, 0, 12, 50, true),
  f("guacamole", "oz", 0.5, 4, 2, 45, true),
];

function f(name, unit, p, fat, c, cal, verify) {
  return {
    id: uid(),
    name,
    unit,
    type: "component",
    macros: { p, f: fat, c, cal },
    verify: !!verify,
    ingredients: [],
    servings: 1,
  };
}

/* build a recipe by resolving ingredient names against SEED_FOODS.
   ings = [[name, qty], ...]. Unmatched names are skipped (logged). */
function recipe(name, servings, ings) {
  const ingredients = [];
  for (const [iname, qty] of ings) {
    const base = SEED_FOODS.find((x) => x.name === iname);
    if (base) ingredients.push({ foodId: base.id, qty });
  }
  return {
    id: uid(),
    name,
    unit: "serving",
    type: "recipe",
    macros: { p: 0, f: 0, c: 0, cal: 0 },
    verify: true,
    ingredients,
    servings,
  };
}

const SEED_RECIPES = [
  recipe("Chicken Salad", 6, [
    ["chicken breast", 36],
    ["celery stalk", 6],
    ["red onion", 8],
    ["honey roasted almonds", 7],
    ["nonfat Greek yogurt", 3],
    ["lite miracle whip", 24],
    ["dijon mustard", 4],
    ["white vinegar", 2],
  ]),
  recipe("Broccoli Beef & Mushroom", 6, [
    ["96/4 ground beef", 32],
    ["broccoli", 6],
    ["mushrooms", 32],
    ["quinoa (cooked)", 2],
    ["soy sauce", 16],
    ["cornstarch", 3],
    ["brown sugar substitute", 6],
  ]),
  recipe("Salsa Chicken", 6, [
    ["chicken breast", 48],
    ["minced garlic", 1],
    ["Pace salsa", 4],
    ["guacamole", 16],
  ]),
  recipe("White Chili", 6, [
    ["99/1 ground turkey", 32],
    ["yellow onion", 1],
    ["minced garlic", 3],
    ["great northern beans", 4],
    ["diced tomatoes", 2],
    ["fat free half and half", 1],
    ["nonfat Greek yogurt", 1],
    ["cornstarch", 4],
  ]),
];

const SEED_ALL = [...SEED_FOODS, ...SEED_RECIPES];

const SEED_PHASES = [
  ph("Mini-cut",       155, 42, 226, 1902, "phase-minicut"),
  ph("Cut",            155, 52, 316, 2352, "phase-cut"),
  ph("Maintenance",    133, 71, 345, 2551, "phase-maintenance"),
  ph("Bulk",           133, 78, 392, 2802, "phase-bulk"),
  ph("Weekend/Refeed", 126, 90, 422, 3002, "phase-weekend"),
];
function ph(name, p, f, c, cal, stableId) {
  return { id: stableId || uid(), name, target: { p, f, c, cal } };
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/* ---------- macro math ---------- */
// resolve a food's macros PER UNIT (recipes resolve to per-serving)
function foodMacros(food, foods) {
  if (food.type === "component") return food.macros;
  // recipe: sum ingredients, divide by servings
  const sum = { p: 0, f: 0, c: 0, cal: 0 };
  for (const ing of food.ingredients) {
    const base = foods.find((x) => x.id === ing.foodId);
    if (!base) continue;
    const m = foodMacros(base, foods);
    sum.p += m.p * ing.qty;
    sum.f += m.f * ing.qty;
    sum.c += m.c * ing.qty;
    sum.cal += m.cal * ing.qty;
  }
  const s = food.servings || 1;
  return { p: sum.p / s, f: sum.f / s, c: sum.c / s, cal: sum.cal / s };
}
function scale(m, qty) {
  return { p: m.p * qty, f: m.f * qty, c: m.c * qty, cal: m.cal * qty };
}
function addM(a, b) {
  return { p: a.p + b.p, f: a.f + b.f, c: a.c + b.c, cal: a.cal + b.cal };
}
const ZERO = { p: 0, f: 0, c: 0, cal: 0 };
const r1 = (n) => Math.round(n * 10) / 10;
const r0 = (n) => Math.round(n);

/* ---------- default day ----------
   targetId: an optional per-weekday macro-target override (e.g. Sat =
   Refeed). null = follow the diet phase in effect on the date (B2). */
function newDay() {
  return {
    targetId: null,
    slots: [
      { id: uid(), name: "Meal 1", entries: [] },
      { id: uid(), name: "Meal 2", entries: [] },
      { id: uid(), name: "Meal 3", entries: [] },
      { id: uid(), name: "Meal 4", entries: [] },
    ],
  };
}

/* ---------- copy a day's meal plan onto other day(s) ---------- */
// Replaces target day(s)' slots wholesale with a deep clone of the
// source day's slots. Entries carry no id (just {foodId, qty}), and
// slot ids are only ever used as React keys within a single day's
// render, so there's no cross-day collision to worry about — a full
// replace is simplest and safest (idempotent, no risk of a merge
// duplicating entries if the action is triggered twice).
// targetId (the day's target override) is left untouched unless
// copyTarget is true — an override (e.g. Sat = Refeed) is usually
// specific to that day, not the day you're copying meals from.
function copyDayTo(week, sourceKey, targetKeys, { copyTarget = false } = {}) {
  const source = week[sourceKey];
  if (!source) return week;
  const next = { ...week };
  for (const key of targetKeys) {
    if (!next[key]) continue;
    next[key] = {
      ...next[key],
      slots: JSON.parse(JSON.stringify(source.slots)),
      targetId: copyTarget ? source.targetId ?? null : next[key].targetId ?? null,
    };
  }
  return next;
}

/* ============================================================
   AUTH SCREEN — email OTP (no redirect needed, iframe-safe)
   ============================================================ */
function AuthScreen({ onAuthed }) {
  const [stage, setStage] = useState("email"); // "email" | "code"
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const sendCode = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await sbRequestOtp(email.trim());
      setStage("code");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const session = await sbVerifyOtp(email.trim(), code.trim());
      onAuthed(session);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{...S.app, display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh"}}>
      <Style />
      <div style={{...S.modal, maxWidth: 360, position:"static", margin:"0 16px"}}>
        <div style={{padding: 24}}>
          <div style={S.brand}>
            <span style={S.brandMark}>◢</span>
            <div>
              <div style={S.brandName}>MEAL&nbsp;PREP</div>
              <div style={S.brandSub}>sign in to sync your data</div>
            </div>
          </div>

          {stage === "email" ? (
            <>
              <label style={S.fLabel}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={{...S.fInput, marginBottom: 12}}
                onKeyDown={(e) => e.key === "Enter" && sendCode()}
                autoFocus
              />
              <button style={{...S.primaryBtn, width:"100%"}} onClick={sendCode} disabled={busy}>
                {busy ? "sending…" : "send login code"}
              </button>
            </>
          ) : (
            <>
              <p style={{...S.note, marginBottom: 12}}>
                Check <strong style={{color:"#e8efe9"}}>{email}</strong> for a 6-digit code.
              </p>
              <label style={S.fLabel}>Code</label>
              <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                style={{...S.fInput, marginBottom: 12, letterSpacing: 4, fontSize: 18, textAlign:"center"}}
                onKeyDown={(e) => e.key === "Enter" && verify()}
                autoFocus
              />
              <button style={{...S.primaryBtn, width:"100%", marginBottom: 8}} onClick={verify} disabled={busy}>
                {busy ? "verifying…" : "verify & sign in"}
              </button>
              <button style={{...S.ghostBtn, width:"100%"}} onClick={() => setStage("email")}>
                use a different email
              </button>
            </>
          )}

          {err && <div style={{...S.verifyBanner, marginTop: 12}}>{err}</div>}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   APP
   ============================================================ */
export default function App() {
  const [tab, setTab] = useState("plan");
  const [store, setStore] = useState(null); // { foods, phases, week } — atomic
  const [loaded, setLoaded] = useState(false);
  // The date being viewed in Plan. The meal plan itself is still one
  // repeating Mon–Sun template (dated per-day plans come later), so a date
  // resolves to its weekday's template day — the date adds the week strip,
  // the month calendar, and which diet phase that day falls in.
  const [selectedDate, setSelectedDate] = useState(() => todayISO());
  const activeDay = weekdayKey(selectedDate);
  const setActiveDay = (dayKey) =>
    setSelectedDate(addDaysISO(mondayOf(selectedDate), DAYS.indexOf(dayKey)));
  const [showMonth, setShowMonth] = useState(false);
  const [debugLog, setDebugLog] = useState([]);
  const [session, setSession] = useState(null);     // null = not yet checked
  const [sessionChecked, setSessionChecked] = useState(false);
  const [loadError, setLoadError] = useState(false); // true = load threw; block saving so we can't overwrite good data
  const [reloadNonce, setReloadNonce] = useState(0); // bump to retry a failed load
  const [saveError, setSaveError] = useState(null);  // last save error message, shown as a banner
  const [saveConflict, setSaveConflict] = useState(false); // row changed on another device — autosave paused
  // What the server holds as far as this device knows: its updated_at (the
  // version a save must match) and the serialized store it matches. A store
  // equal to `json` has nothing to save — so just opening the app writes nothing.
  const savedRef = useRef({ updatedAt: null, json: null });
  // saves run one at a time: two in flight from the same base would make the
  // second look like a conflict with the first
  const saveChainRef = useRef(Promise.resolve());
  const [dietPhases, setDietPhases] = useState([]);  // every diet_phases row (history + planned)
  const dietPhase = phaseOnDate(dietPhases, todayISO()); // the phase in effect today
  const [bwLog, setBwLog] = useState([]);             // last 14 days of weigh-ins, oldest first
  const [intake, setIntake] = useState({});           // food log rows by date (loaded on demand)
  const [intakeError, setIntakeError] = useState(null);
  const [showBwModal, setShowBwModal] = useState(false);
  const [sideLoadError, setSideLoadError] = useState(null); // diet phase / weigh-in load failed — shown as a banner
  const [sideLoadNonce, setSideLoadNonce] = useState(0);   // bump to retry that load
  const dbg = (msg) => setDebugLog((prev) => [`${new Date().toLocaleTimeString()}: ${msg}`, ...prev.slice(0, 19)]);

  // restore session from local storage on mount (per-device, just holds the token)
  useEffect(() => {
    (async () => {
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw) {
          const sess = JSON.parse(raw);
          // try refresh — tokens expire after ~1hr
          try {
            const refreshed = await sbRefreshToken(sess.refresh_token);
            const newSession = { access_token: refreshed.access_token, refresh_token: refreshed.refresh_token, user: refreshed.user || sess.user };
            localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
            setSession(newSession);
          } catch {
            setSession(sess); // use as-is, may still be valid
          }
        }
      } catch (e) {
        /* no session yet */
      } finally {
        setSessionChecked(true);
      }
    })();
  }, []);

  const handleAuthed = async (rawSession) => {
    const sess = { access_token: rawSession.access_token, refresh_token: rawSession.refresh_token, user: rawSession.user };
    localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
    setSession(sess);
  };

  // Queue a save of `data` behind any save already running. Skips it if it
  // matches what the server already has; otherwise saves over the last-seen
  // version and advances the baseline. Rejects with the error (conflict or not).
  const queueSave = (data) => {
    const run = saveChainRef.current.then(async () => {
      const json = JSON.stringify(data);
      if (json === savedRef.current.json) return;
      const updatedAt = await sbSaveAppData(session, data, savedRef.current.updatedAt);
      savedRef.current = { updatedAt, json };
      dbg("saved to supabase — foods:" + data.foods?.length + " phases:" + data.phases?.length);
    });
    saveChainRef.current = run.catch(() => {}); // a failed save mustn't block the next
    return run;
  };

  const signOut = async () => {
    // Flush any pending (debounced) edit before tearing down. Without this, the 400ms save
    // timer is cancelled by the teardown below, silently dropping the user's last edit.
    try {
      if (loaded && store && session && !loadError && !saveConflict) {
        await queueSave(store);
      }
    } catch (e) {
      dbg("final save on signOut FAILED: " + e.message);
      const proceed = window.confirm(
        e.conflict
          ? "Your data was changed on another device, so your latest changes here weren't saved. Sign out anyway and lose them?"
          : "Your most recent changes could not be saved. Sign out anyway and lose them?"
      );
      if (!proceed) return; // abort sign-out so the user can stay and retry
    }
    if (saveConflict && !window.confirm("Changes here weren't saved (data changed on another device). Sign out anyway and lose them?")) return;
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setStore(null);
    setLoaded(false);
    setLoadError(false);
    setSaveError(null);
    setSaveConflict(false);
    setSideLoadError(null);
    setShowBwModal(false);
    savedRef.current = { updatedAt: null, json: null };
    dailyCheckDayRef.current = null;
    setIntake({});
    setIntakeError(null);
  };

  // retry a failed load without a full page reload
  const retryLoad = () => { setLoadError(false); setReloadNonce((n) => n + 1); };

  // conflict → "load latest": drop this device's unsaved changes, re-read the row
  const conflictLoadLatest = () => {
    setSaveConflict(false);
    setSaveError(null);
    setLoaded(false);
    setReloadNonce((n) => n + 1);
  };

  // conflict → "keep mine": take the server's current version as the base, so
  // the next save deliberately overwrites what the other device wrote
  const conflictKeepMine = async () => {
    try {
      const row = await sbLoadAppData(session);
      savedRef.current = { updatedAt: row ? row.updated_at : null, json: null };
      setSaveConflict(false);
      setSaveError(null);
      await queueSave(store);
    } catch (e) {
      dbg("keep-mine save FAILED: " + e.message);
      if (e.conflict) setSaveConflict(true);
      else setSaveError(e.message || "save failed");
    }
  };

  // convenience destructure — safe because render is gated on loaded+store
  const foods  = store ? store.foods  : SEED_ALL;
  const phases = store ? store.phases : SEED_PHASES;
  const week   = store ? store.week   : null;

  const setFoods  = (val) => setStore((s) => ({ ...s, foods:  typeof val === "function" ? val(s.foods)  : val }));
  const setPhases = (val) => setStore((s) => ({ ...s, phases: typeof val === "function" ? val(s.phases) : val }));
  const setWeek   = (val) => setStore((s) => ({ ...s, week:   typeof val === "function" ? val(s.week)   : val }));

  // load — from Supabase, once session is available
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      setLoadError(false);
      const seedWeek = () => {
        const w = {};
        DAYS.forEach((d) => (w[d] = newDay()));
        return w;
      };
      const nameToStableId = {
        "Mini-cut": "phase-minicut",
        "Cut": "phase-cut",
        "Maintenance": "phase-maintenance",
        "Bulk": "phase-bulk",
        "Weekend/Refeed": "phase-weekend",
      };
      try {
        const row = await sbLoadAppData(session);
        if (cancelled) return;
        dbg("supabase load: " + (row ? "found row" : "no row yet — new user"));
        if (row && row.foods) {
          const loadedFoods = (row.foods && row.foods.length) ? row.foods : SEED_ALL;

          // migrate phase ids to stable
          let loadedPhases = (row.phases && row.phases.length) ? row.phases : SEED_PHASES;
          const idRemap = {};
          loadedPhases = loadedPhases.map((p) => {
            const stableId = nameToStableId[p.name];
            if (stableId && p.id !== stableId) { idRemap[p.id] = stableId; return { ...p, id: stableId }; }
            return p;
          });

          let loadedWeek = row.week && Object.keys(row.week).length ? row.week : seedWeek();
          // Days saved before targets followed the diet phase carry a
          // per-weekday phaseId that was always set (default Maintenance).
          // One-time move: drop it so the day follows its diet phase; any
          // deliberate override is re-picked in the TARGETS dropdown.
          const migrated = {};
          for (const [day, val] of Object.entries(loadedWeek)) {
            const { phaseId, ...rest } = val;
            const targetId = "targetId" in val ? val.targetId : null;
            migrated[day] = { ...rest, targetId: targetId ? idRemap[targetId] || targetId : null };
          }
          loadedWeek = migrated;

          const loadedStore = { foods: loadedFoods, phases: loadedPhases, week: loadedWeek };
          // baseline = what was loaded, so opening the app doesn't re-save it.
          // (Seed fallbacks / the id migration above save with the next real edit.)
          savedRef.current = { updatedAt: row.updated_at, json: JSON.stringify(loadedStore) };
          setStore(loadedStore);
        } else {
          // new user (query SUCCEEDED, returned no row) — seed defaults, saved on first change.
          // A row with no foods still exists, so its updated_at is the base to save over.
          const seeded = { foods: SEED_ALL, phases: SEED_PHASES, week: seedWeek() };
          savedRef.current = { updatedAt: row ? row.updated_at : null, json: JSON.stringify(seeded) };
          setStore(seeded);
        }
        setLoaded(true); // only mark loaded on a SUCCESSFUL read — this is what enables saving
      } catch (e) {
        if (cancelled) return;
        // Load FAILED (network / permission / transient). Deliberately do NOT seed defaults
        // and do NOT setLoaded(true): doing so would let the save effect fire and overwrite
        // the real DB row with seed data. Surface a recoverable error instead.
        dbg("LOAD FAILED: " + e.message);
        setLoadError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [session, reloadNonce]);

  // save — to Supabase, triggered by store changes (debounced)
  // Paused while a conflict is unresolved, so this device can't keep writing
  // over the other one; the banner offers "load latest" or "keep mine".
  useEffect(() => {
    if (!loaded || !store || !session || loadError || saveConflict) return;
    const t = setTimeout(() => {
      queueSave(store)
        .then(() => setSaveError(null))
        .catch((e) => {
          dbg("SAVE FAILED: " + e.message);
          if (e.conflict) setSaveConflict(true);
          else setSaveError(e.message || "save failed");
        });
    }, 400);
    return () => clearTimeout(t);
  }, [store, loaded, session, loadError, saveConflict]);

  // Once-a-day check, run on load AND whenever the app comes back to the
  // foreground on a new day — a home-screen app can sit suspended overnight
  // without reloading, so "on load" alone would miss the morning. Diet phases
  // reload with it (the phase in effect can change at midnight). The two loads
  // fail independently, and a failure shows a banner rather than vanishing
  // into the debug log (a permissions break once hid this prompt for weeks).
  const dailyCheckDayRef = useRef(null); // the day the check last succeeded for
  useEffect(() => {
    if (!loaded || !session) return;
    let cancelled = false;
    const runDailyCheck = async () => {
      const day = todayISO();
      if (dailyCheckDayRef.current === day) return;
      const [phases, weights] = await Promise.allSettled([
        sbLoadDietPhases(session),
        sbLoadRecentBodyweight(session),
      ]);
      if (cancelled) return;
      const failed = [];
      if (phases.status === "fulfilled") setDietPhases(phases.value);
      else { failed.push("diet phases"); dbg("diet phase load FAILED: " + phases.reason?.message); }
      if (weights.status === "fulfilled") {
        dailyCheckDayRef.current = day;
        setBwLog(weights.value);
        const todayRow = weights.value.find((r) => r.date === day);
        if (!todayRow && !bwSkippedOn(day)) setShowBwModal(true);
      } else {
        failed.push("today's weigh-in");
        dbg("bodyweight load FAILED: " + weights.reason?.message);
      }
      setSideLoadError(failed.length ? `couldn't load ${failed.join(" or ")}` : null);
    };
    runDailyCheck();
    const onVisible = () => { if (document.visibilityState === "visible") runDailyCheck(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onVisible); };
  }, [loaded, session, sideLoadNonce]);

  const reloadDietPhases = async () => setDietPhases(await sbLoadDietPhases(session));

  const switchPhase = async (preset) => {
    try {
      await sbSwitchDietPhase(session, preset, dietPhases, phases);
      await reloadDietPhases();
    } catch (e) {
      dbg("switch phase FAILED: " + e.message);
      window.alert("Couldn't switch phase — " + e.message);
    }
  };

  // calendar edits (MonthSheet): run the write, then re-read every row so
  // the calendar always shows what's actually stored
  const editDietPhases = async (write) => {
    try {
      await write(session);
      await reloadDietPhases();
      return true;
    } catch (e) {
      dbg("edit phase FAILED: " + e.message);
      window.alert("Couldn't save phase — " + e.message);
      return false;
    }
  };

  const saveBodyweight = async (weight) => {
    try {
      await sbLogBodyweight(session, weight);
      const day = todayISO();
      setBwLog((log) => [...log.filter((r) => r.date !== day), { date: day, weight }].sort((a, b) => (a.date < b.date ? -1 : 1)));
      setShowBwModal(false);
    } catch (e) {
      dbg("log bodyweight FAILED: " + e.message);
      window.alert("Couldn't save — " + e.message);
    }
  };

  // localStorage, not sessionStorage: iOS clears session storage whenever it
  // kills a suspended home-screen app, which would re-ask after a skip
  const skipBodyweight = () => {
    try { localStorage.setItem(BW_SKIP_KEY, todayISO()); } catch { /* storage blocked — skip lasts this session only */ }
    setShowBwModal(false);
  };

  const retrySideLoad = () => { dailyCheckDayRef.current = null; setSideLoadError(null); setSideLoadNonce((n) => n + 1); };

  // Food log for the date being viewed in Plan — only today and past dates
  // can be logged. Cached per date; every write re-reads that date so the
  // screen always shows what's actually stored.
  const loggable = selectedDate <= todayISO();
  const reloadIntake = async (date) => {
    try {
      const rows = await sbLoadIntake(session, date);
      setIntake((m) => ({ ...m, [date]: rows }));
      setIntakeError(null);
    } catch (e) {
      dbg("food log load FAILED: " + e.message);
      setIntakeError(e.message);
    }
  };
  useEffect(() => {
    if (!loaded || !session || !loggable || intake[selectedDate]) return;
    reloadIntake(selectedDate);
  }, [loaded, session, selectedDate, loggable]);

  // one write at a time per date+key, so a double tap can't log a meal twice
  const intakeBusyRef = useRef(new Set());
  const intakeWrite = async (key, write) => {
    const date = selectedDate;
    const k = date + ":" + key;
    if (intakeBusyRef.current.has(k)) return;
    intakeBusyRef.current.add(k);
    try {
      await write(session, date);
    } catch (e) {
      dbg("food log write FAILED: " + e.message);
      window.alert("Couldn't update the food log — " + e.message);
    } finally {
      intakeBusyRef.current.delete(k);
      await reloadIntake(date);
    }
  };
  const intakeOps = {
    checkSlot: (slot) =>
      intakeWrite("slot:" + slot.id, (s, date) => {
        const rows = slot.entries
          .map((e) => ({ e, food: foods.find((x) => x.id === e.foodId) }))
          .filter(({ food }) => food)
          .map(({ e, food }) => intakeRow(date, { slotId: slot.id, slotName: slot.name, food, foods, qty: e.qty, source: "plan" }));
        return rows.length ? sbInsertIntake(s, rows) : null;
      }),
    uncheckSlot: (slotId) =>
      intakeWrite("slot:" + slotId, (s, date) => sbDeleteIntake(s, `date=eq.${date}&slot_id=eq.${encodeURIComponent(slotId)}`)),
    addFood: ({ slotId, slotName, food, qty, source }) =>
      intakeWrite("add:" + uid(), (s, date) => sbInsertIntake(s, [intakeRow(date, { slotId, slotName, food, foods, qty, source })])),
    // Quick Add: a one-off entry logged straight to the day. p/f/c null =
    // unknown (calories-only). With saveFood it also becomes a library food.
    addQuick: ({ slotId, slotName, name, p, f, c, cal, saveFood }) => {
      let foodId = null;
      if (saveFood) {
        foodId = uid();
        setFoods((prev) => [...prev, {
          id: foodId, name, unit: "serving", type: "component",
          // calories-only: macros unknown, so flag it for verification
          macros: { p: p ?? 0, f: f ?? 0, c: c ?? 0, cal }, verify: p == null, ingredients: [], servings: 1,
        }]);
      }
      return intakeWrite("add:" + uid(), (s, date) => sbInsertIntake(s, [{
        date, slot_id: slotId || null, slot_name: slotName, food_id: foodId,
        food_name: name || "Quick add", unit: "serving", qty: 1, p, f, c, cal, source: "quick",
      }]));
    },
    setQty: (id, qty) => intakeWrite("row:" + id, (s) => sbUpdateIntake(s, id, { qty })),
    remove: (id) => intakeWrite("row:" + id, (s) => sbDeleteIntake(s, `id=eq.${id}`)),
  };

  // not checked session yet — brief splash
  if (!sessionChecked) {
    return (
      <div style={{...S.app, display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh"}}>
        <Style />
        <div style={{color:"#46e6a0", fontFamily:"'Archivo',sans-serif", letterSpacing:2, fontSize:13}}>LOADING...</div>
      </div>
    );
  }

  // not signed in — show auth screen
  if (!session) {
    return <AuthScreen onAuthed={handleAuthed} />;
  }

  // load failed — recoverable error screen. Critical: this must come BEFORE the SYNCING
  // gate, because on load failure `loaded` stays false and we'd otherwise hang on SYNCING.
  if (loadError) {
    return (
      <div style={{...S.app, display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:16}}>
        <Style />
        <div style={{...S.modal, maxWidth: 380, position:"static"}}>
          <div style={{padding: 24, textAlign:"center"}}>
            <div style={{fontSize: 28, marginBottom: 8}}>⚠</div>
            <div style={{fontFamily:"'Archivo',sans-serif", fontWeight:800, letterSpacing:1, fontSize:15, marginBottom:8}}>
              COULDN'T LOAD YOUR DATA
            </div>
            <p style={{...S.note, marginBottom: 16}}>
              Your saved data was <strong style={{color:"#e8efe9"}}>not touched</strong> — the app just
              couldn't reach it. Usually a network blip or an expired session.
            </p>
            <button style={{...S.primaryBtn, width:"100%", marginBottom: 8}} onClick={retryLoad}>
              retry
            </button>
            <button style={{...S.ghostBtn, width:"100%"}} onClick={signOut}>
              sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // signed in but data not yet loaded from Supabase
  if (!loaded || !store) {
    return (
      <div style={{...S.app, display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh"}}>
        <Style />
        <div style={{color:"#46e6a0", fontFamily:"'Archivo',sans-serif", letterSpacing:2, fontSize:13}}>SYNCING...</div>
      </div>
    );
  }

  return (
    <div style={S.app}>
      <Style />
      {showBwModal && <BodyweightModal onSave={saveBodyweight} onSkip={skipBodyweight} />}
      {showMonth && (
        <MonthSheet
          selectedDate={selectedDate}
          dietPhases={dietPhases}
          presets={phases}
          onSelectDate={(iso) => { setSelectedDate(iso); setShowMonth(false); }}
          onEdit={editDietPhases}
          onClose={() => setShowMonth(false)}
        />
      )}
      {saveConflict && (
        <div style={S.saveBanner}>
          <span>⚠ changed on another device — your edits here aren't saved</span>
          <button style={S.saveBannerBtn} onClick={conflictLoadLatest}>load latest</button>
          <button style={S.saveBannerBtn} onClick={conflictKeepMine}>keep mine</button>
        </div>
      )}
      {sideLoadError && (
        <div style={S.saveBanner}>
          <span>⚠ {sideLoadError}</span>
          <button style={S.saveBannerBtn} onClick={retrySideLoad}>retry</button>
        </div>
      )}
      {saveError && (
        <div style={S.saveBanner}>
          <span>⚠ last change didn't save — {saveError}</span>
          <button style={S.saveBannerBtn} onClick={() => setSaveError(null)}>dismiss</button>
        </div>
      )}
      <header style={S.header}>
        <div style={S.brand}>
          <span style={S.brandMark}>◢</span>
          <div>
            <div style={S.brandName}>MEAL&nbsp;PREP</div>
            <div style={S.brandSub}>{session.user?.email || "synced"}</div>
          </div>
          <div style={{flex:1}} />
          <button style={{...S.ghostBtn, padding:"6px 10px", fontSize:11}} onClick={signOut}>
            sign out
          </button>
        </div>
        <nav style={S.nav}>
          {[
            ["plan", "Plan"],
            ["foods", "Foods"],
            ["phases", "Phases"],
            ["data", "Data"],
          ].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{ ...S.navBtn, ...(tab === k ? S.navBtnOn : {}) }}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main style={S.main}>
        {tab === "plan" && (
          <Plan
            week={week}
            setWeek={setWeek}
            foods={foods}
            setFoods={setFoods}
            phases={phases}
            activeDay={activeDay}
            setActiveDay={setActiveDay}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            dietPhases={dietPhases}
            bwLog={bwLog}
            loggable={loggable}
            intakeRows={loggable ? intake[selectedDate] || null : null}
            intakeError={intakeError}
            onRetryIntake={() => reloadIntake(selectedDate)}
            intakeOps={intakeOps}
            onOpenMonth={() => setShowMonth(true)}
          />
        )}
        {tab === "foods" && (
          <Foods foods={foods} setFoods={setFoods} />
        )}
        {tab === "phases" && (
          <Phases
            phases={phases}
            setPhases={setPhases}
            dietPhase={dietPhase}
            dietPhases={dietPhases}
            bwLog={bwLog}
            onSwitchPhase={switchPhase}
            onOpenCalendar={() => { setTab("plan"); setShowMonth(true); }}
          />
        )}
        {tab === "data" && (
          <Data
            foods={foods}
            phases={phases}
            week={week}
            setFoods={setFoods}
            setPhases={setPhases}
            setWeek={setWeek}
            debugLog={debugLog}
          />
        )}
      </main>
    </div>
  );
}

/* ============================================================
   PLAN
   ============================================================ */
function Plan({ week, setWeek, foods, setFoods, phases, activeDay, setActiveDay, selectedDate, setSelectedDate, dietPhases, bwLog, loggable, intakeRows, intakeError, onRetryIntake, intakeOps, onOpenMonth }) {
  const day = week[activeDay];
  // The day's macro targets: the preset of the diet phase in effect on the
  // selected date, unless this weekday has its own override (e.g. Refeed).
  const dietPhaseOnDay = phaseOnDate(dietPhases, selectedDate);
  const followed = dietPhaseOnDay ? phases.find((p) => p.id === dietPhaseOnDay.phase_id) || null : null;
  const override = day.targetId ? phases.find((p) => p.id === day.targetId) || null : null;
  const phase = override || followed;
  const followLabel = followed
    ? `${followed.name} (diet phase)`
    : dietPhaseOnDay
      ? `${dietPhaseOnDay.phase_name} — no matching targets`
      : "no diet phase set";
  // Where a picked / scanned food goes:
  //   { mode: "template", slotId }            → the weekly plan (every <weekday>)
  //   { mode: "log", slotId, slotName }       → this date's food log only
  const [picker, setPicker] = useState(null);
  const [scanTarget, setScanTarget] = useState(null);
  const [quickTarget, setQuickTarget] = useState(null); // { slotId, slotName } for Quick Add
  const [pendingScan, setPendingScan] = useState(null); // { target, barcode }
  const [copySource, setCopySource] = useState(null); // day key being copied FROM, or null

  // food log rows for this date, by template meal; rows whose meal isn't in
  // the template (extras, or a meal since deleted) go under Extras
  const slotIds = new Set(day.slots.map((s) => s.id));
  const loggedBySlot = {};
  const extraRows = [];
  for (const r of intakeRows || []) {
    if (r.slot_id && slotIds.has(r.slot_id)) (loggedBySlot[r.slot_id] ||= []).push(r);
    else extraRows.push(r);
  }
  const eaten = useMemo(() => intakeTotal(intakeRows), [intakeRows]);

  const addToLog = (target, food, qty, source) =>
    intakeOps.addFood({ slotId: target.slotId || null, slotName: target.slotName || "Extras", food, qty, source });

  const dayTotal = useMemo(() => {
    let t = ZERO;
    for (const slot of day.slots) {
      for (const e of slot.entries) {
        const food = foods.find((x) => x.id === e.foodId);
        if (!food) continue;
        t = addM(t, scale(foodMacros(food, foods), e.qty));
      }
    }
    return t;
  }, [day, foods]);

  const update = (fn) => {
    const copy = JSON.parse(JSON.stringify(week));
    fn(copy[activeDay]);
    setWeek(copy);
  };

  // create a new component food from the picker's inline "add food" form,
  // append it to the master library, and hand back the saved record so the
  // caller can reference its id (e.g. tag it "just added" in the list).
  const createFood = (draft) => {
    const newFood = {
      id: uid(),
      name: draft.name.trim(),
      unit: draft.unit.trim() || "unit",
      type: "component",
      macros: draft.macros,
      verify: !!draft.verify,
      ingredients: [],
      servings: 1,
    };
    setFoods((prev) => [...prev, newFood]);
    return newFood;
  };

  const moveSlot = (si, dir) => {
    const target = si + dir;
    if (target < 0 || target >= day.slots.length) return;
    update((d) => {
      const slots = [...d.slots];
      const [moved] = slots.splice(si, 1);
      slots.splice(target, 0, moved);
      d.slots = slots;
    });
  };

  // copy a single meal slot's entries onto the next day. Matches by slot
  // name first (so "Meal 2" lands in the next day's "Meal 2"); if no slot
  // with that name exists there, appends a new one with the same name.
  const dayIdx = DAYS.indexOf(activeDay);
  const nextDayKey = dayIdx < DAYS.length - 1 ? DAYS[dayIdx + 1] : null;
  const copySlotToNextDay = (slot) => {
    if (!nextDayKey) return;
    setWeek((w) => {
      const next = { ...w };
      const targetDay = { ...next[nextDayKey] };
      const slots = JSON.parse(JSON.stringify(targetDay.slots));
      const clonedEntries = JSON.parse(JSON.stringify(slot.entries));
      const ti = slots.findIndex((s) => s.name === slot.name);
      if (ti !== -1) {
        slots[ti] = { ...slots[ti], entries: clonedEntries };
      } else {
        slots.push({ id: uid(), name: slot.name, entries: clonedEntries });
      }
      targetDay.slots = slots;
      next[nextDayKey] = targetDay;
      return next;
    });
  };

  return (
    <div>
      <PhaseCard dietPhases={dietPhases} bwLog={bwLog} onOpenMonth={onOpenMonth} presets={phases} week={week} />

      <DateStrip
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        dietPhases={dietPhases}
        onOpenMonth={onOpenMonth}
        onCopyDay={(d) => setCopySource(d)}
      />

      {/* phase + target dashboard */}
      <div style={S.dash}>
        <div style={S.dashHead}>
          {/* follows the diet phase by default; picking a preset overrides it
              for this weekday (every week) */}
          <label style={S.dashLabel}>TARGETS</label>
          <select
            key={day.targetId || "follow"}
            value={day.targetId || ""}
            onChange={(e) => update((d) => (d.targetId = e.target.value || null))}
            style={S.select}
          >
            <option value="">{followLabel}</option>
            {phases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · every {activeDay}
              </option>
            ))}
          </select>
        </div>
        {/* today / past: what was eaten (checked-off meals + extras); future: the plan */}
        <MacroBars total={loggable ? eaten : dayTotal} target={phase ? phase.target : null} />
      </div>

      {loggable && intakeError && (
        <div style={{ ...S.verifyBanner, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span>⚠ couldn't load the food log — {intakeError}</span>
          <button style={S.saveBannerBtn} onClick={onRetryIntake}>retry</button>
        </div>
      )}

      {/* meal slots — reorderable via up/down */}
      {day.slots.map((slot, si) => (
        <Slot
          key={slot.id}
          slot={slot}
          foods={foods}
          loggable={loggable && intakeRows !== null}
          logged={loggedBySlot[slot.id] || null}
          onCheck={() => intakeOps.checkSlot(slot)}
          onUncheck={() =>
            window.confirm(`Remove ${slot.name} from this day's food log?`) && intakeOps.uncheckSlot(slot.id)
          }
          onLogQty={(id, qty) => intakeOps.setQty(id, qty)}
          onLogRemove={(id) => intakeOps.remove(id)}
          onQuickAdd={() => setQuickTarget({ slotId: slot.id, slotName: slot.name })}
          isFirst={si === 0}
          isLast={si === day.slots.length - 1}
          onMoveUp={() => moveSlot(si, -1)}
          onMoveDown={() => moveSlot(si, 1)}
          onRename={(name) =>
            update((d) => (d.slots[si].name = name))
          }
          onRemoveSlot={() =>
            update((d) => d.slots.splice(si, 1))
          }
          onCopyNext={() => copySlotToNextDay(slot)}
          canCopyNext={!!nextDayKey}
          onAdd={() => setPicker(loggedBySlot[slot.id] ? { mode: "log", slotId: slot.id, slotName: slot.name } : { mode: "template", slotId: slot.id })}
          onScan={() => setScanTarget(loggedBySlot[slot.id] ? { mode: "log", slotId: slot.id, slotName: slot.name } : { mode: "template", slotId: slot.id })}
          onQty={(ei, qty) =>
            update((d) => (d.slots[si].entries[ei].qty = qty))
          }
          onRemoveEntry={(ei) =>
            update((d) => d.slots[si].entries.splice(ei, 1))
          }
        />
      ))}

      <button
        style={S.addSlot}
        onClick={() =>
          update((d) =>
            d.slots.push({
              id: uid(),
              name: "Meal " + (d.slots.length + 1),
              entries: [],
            })
          )
        }
      >
        + add meal slot
      </button>

      {/* unplanned food on this date — goes in the log only, never the template */}
      {loggable && intakeRows !== null && (
        <div style={S.slot}>
          <div style={S.slotHead}>
            <span style={{ ...S.slotName, flex: 1, borderBottom: "none" }}>Extras</span>
            <span style={S.slotMacros}>
              {(() => { const t = intakeTotal(extraRows); return `${r0(t.cal)} kcal · ${r1(t.p)}P · ${r1(t.f)}F · ${r1(t.c)}C`; })()}
            </span>
          </div>
          {extraRows.length === 0 && <div style={S.extrasNote}>Anything not in the plan — a snack, a protein bar. Logged to this day only.</div>}
          {extraRows.map((r) => (
            <LogEntry key={r.id} row={r} onQty={(q) => intakeOps.setQty(r.id, q)} onRemove={() => intakeOps.remove(r.id)} />
          ))}
          <button style={S.addEntry} onClick={() => setQuickTarget({ slotId: null, slotName: "Extras" })}>+ quick add</button>
          <button style={S.addEntry} onClick={() => setPicker({ mode: "log", slotId: null, slotName: "Extras" })}>+ food</button>
          <button style={S.addEntry} onClick={() => setScanTarget({ mode: "log", slotId: null, slotName: "Extras" })}>+ scan barcode</button>
        </div>
      )}

      {picker && (
        <FoodPicker
          foods={foods}
          onClose={() => setPicker(null)}
          onCreateFood={createFood}
          onPick={(foodId) => {
            if (picker.mode === "log") {
              const food = foods.find((x) => x.id === foodId);
              if (food) addToLog(picker, food, 1, "manual");
            } else {
              update((d) => {
                const slot = d.slots.find((s) => s.id === picker.slotId);
                if (slot) slot.entries.push({ foodId, qty: 1 });
              });
            }
            setPicker(null);
          }}
        />
      )}

      {quickTarget && (
        <QuickAddModal
          onClose={() => setQuickTarget(null)}
          onLog={(entry) => {
            intakeOps.addQuick({ ...quickTarget, ...entry });
            setQuickTarget(null);
          }}
        />
      )}

      {scanTarget && (
        <BarcodeScanner
          onDetected={(barcode) => {
            const target = scanTarget;
            setScanTarget(null);
            setPendingScan({ target, barcode });
          }}
          onClose={() => setScanTarget(null)}
        />
      )}

      {copySource && (
        <CopyDayModal
          sourceDay={copySource}
          days={DAYS}
          onClose={() => setCopySource(null)}
          onApply={(targetKeys, copyTarget) => {
            setWeek((w) => copyDayTo(w, copySource, targetKeys, { copyTarget }));
            setCopySource(null);
          }}
        />
      )}

      {pendingScan && (
        <ScanConfirm
          barcode={pendingScan.barcode}
          foods={foods}
          onClose={() => setPendingScan(null)}
          onConfirm={({ draft, qty, existingId }) => {
            // existingId reuses a food already scanned before; otherwise this
            // is the first time this barcode's been seen, so add it to the library.
            const foodId = existingId || uid();
            const scanned = existingId
              ? { ...foods.find((f) => f.id === existingId), name: draft.name, unit: draft.unit, macros: draft.macros }
              : {
                  id: foodId,
                  name: draft.name,
                  unit: draft.unit,
                  type: "component",
                  macros: draft.macros,
                  verify: true, // scanned/best-effort, same as seeded foods — review later
                  ingredients: [],
                  servings: 1,
                  barcode: pendingScan.barcode,
                };
            setFoods((prev) =>
              existingId ? prev.map((f) => (f.id === existingId ? scanned : f)) : [...prev, scanned]
            );
            const { target } = pendingScan;
            if (target.mode === "log") {
              addToLog(target, scanned, qty, "barcode");
            } else {
              update((d) => {
                const slot = d.slots.find((s) => s.id === target.slotId);
                if (slot) slot.entries.push({ foodId, qty });
              });
            }
            setPendingScan(null);
          }}
        />
      )}
    </div>
  );
}

/* ============================================================
   PHASE CARD — the diet phase in effect today: week X of Y with a
   progress bar, its target rate, and once there are enough weigh-ins
   to trust it, the actual trend against that target (on pace or not)
   and the projected end weight. Cuts and maintenance are read per week
   over 2 weeks; bulks per month over 4 weeks, since a week of bulk gain
   is smaller than day-to-day noise.
   ============================================================ */
const PHASE_BLURB = {
  deficit: "Lower calories reduce recovery capacity, so RepReport trims your training volume ceilings as the cut goes on.",
  surplus: "Extra calories improve recovery, so RepReport raises your training volume ceilings as the bulk goes on.",
  maintenance: "Calories at maintenance. Training volume runs at your normal baseline.",
};

function PhaseCard({ dietPhases, bwLog, onOpenMonth, presets, week }) {
  const today = todayISO();
  const phase = phaseOnDate(dietPhases, today);

  if (!phase) {
    return (
      <button style={{ ...S.pcCard, ...S.pcEmpty }} onClick={onOpenMonth}>
        No diet phase set — tap to start one on the calendar
      </button>
    );
  }

  const color = PHASE_COLORS[phase.phase_type];
  const prog = phaseProgress(phase, today);
  const pct = prog.plannedWeeks ? Math.min(100, (prog.week / prog.plannedWeeks) * 100) : null;
  const sign = (n, digits) => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n).toFixed(digits);
  const cals = phaseCalories(phase, presets || [], week);
  const ctx = dietPhaseContext(dietPhases, today, bwLog);
  const impact = volumeImpactPct(ctx);
  // only while the last phase is still fading — after that it's history
  const note = ctx?.fading ? transitionNote(dietPhases, phase.start_date, phase.phase_type, prog.plannedWeeks, [phase.id]) : null;
  const impactR = Math.round(impact);
  const markerPct = 50 + (Math.max(-VOLUME_SCALE, Math.min(VOLUME_SCALE, impact)) / VOLUME_SCALE) * 50;
  const impactColor = impactR < 0 ? PHASE_COLORS.deficit : impactR > 0 ? PHASE_COLORS.surplus : PHASE_COLORS.maintenance;

  const monthly = rateIsMonthly(phase.phase_type);
  const ratePct = phaseRatePct(phase);                                   // % per week
  const targetPct = monthly ? ratePct * WEEKS_PER_MONTH : ratePct;       // in display units
  const per = monthly ? "mo" : "wk";
  const trend = monthly ? monthlyWeightTrend(bwLog, today) : weightTrend(bwLog, today);
  const latest = (bwLog || []).length ? Number(bwLog[bwLog.length - 1].weight) : null;
  const refWeight = trend.ready ? trend.avg : latest;

  // pace: actual vs target, in display units
  let pace = null;
  if (trend.ready) {
    const actual = monthly ? trend.pctPerMonth : trend.pctPerWeek;
    if (phase.phase_type === "maintenance") {
      pace = Math.abs(actual) <= 0.25 ? { ok: true, text: "Holding steady" }
        : { ok: false, text: actual > 0 ? "Drifting up" : "Drifting down" };
    } else {
      const tol = monthly ? 0.25 : 0.2;
      const diff = actual - targetPct;
      const losing = phase.phase_type === "deficit";
      if (Math.abs(diff) <= tol) pace = { ok: true, text: "On pace" };
      else if (losing) pace = { ok: false, text: actual >= 0 ? "Not losing yet" : diff > 0 ? "Losing slower than target" : "Losing faster than target" };
      else pace = { ok: false, text: actual <= 0 ? "Not gaining yet" : diff < 0 ? "Gaining slower than target" : "Gaining faster than target" };
    }
  }

  // projected weight at the planned end, at the target pace
  let projection = null;
  if (refWeight && phase.planned_end_date && !prog.overrun && ratePct !== 0) {
    const weeksToEnd = daysBetween(today, phase.planned_end_date) / 7;
    if (weeksToEnd > 0) {
      const end = refWeight * Math.pow(1 + ratePct / 100, weeksToEnd);
      const by = parseISO(phase.planned_end_date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      projection = `≈ ${end.toFixed(1)} ${WEIGHT_UNIT} by ${by} at target pace`;
    }
  }

  const targetText = phase.phase_type === "maintenance"
    ? "Target: hold weight (±0.25%/wk)"
    : `Target: ${sign(targetPct, 2)}%/${per}` +
      (refWeight ? ` (${sign((refWeight * targetPct) / 100, monthly ? 1 : 2)} ${WEIGHT_UNIT}/${per})` : "");

  return (
    <div style={{ ...S.pcCard, borderLeft: `4px solid ${color}` }}>
      <div style={S.pcTop}>
        <div>
          <div style={S.pcKicker}>CURRENT PHASE</div>
          <div style={{ ...S.pcName, color }}>
            {phase.phase_name.toUpperCase()} · WEEK {prog.week}
          </div>
        </div>
        <button style={S.pcLink} onClick={onOpenMonth}>
          {prog.overrun ? "past planned end" : "plan"} ›
        </button>
      </div>
      <div style={S.pcBlurb}>{PHASE_BLURB[phase.phase_type] || PHASE_BLURB.maintenance}</div>

      <div style={S.pcStats}>
        <div>
          <div style={S.pcStatL}>Calories</div>
          <div style={S.pcStatN}>{cals ? Math.round(cals.avg).toLocaleString() : "—"}</div>
          <div style={{ ...S.pcStatSub, color: cals?.pct ? color : dim }}>
            {cals?.pct == null ? "no maintenance target" : cals.isMaintenance || Math.abs(cals.pct) < 0.5 ? "maintenance" : `${sign(cals.pct, 0)}%`}
          </div>
        </div>
        <div>
          <div style={S.pcStatL}>Body weight</div>
          <div style={S.pcStatN}>{trend.ready ? trend.avg.toFixed(1) : "—"}</div>
          <div style={{ ...S.pcStatSub, color: trend.ready ? color : dim }}>
            {trend.ready
              ? monthly ? `${sign(trend.perMonth, 1)} / mo` : `${sign(trend.perWeek, 1)} / wk`
              : "trend not ready"}
          </div>
        </div>
        <div>
          <div style={S.pcStatL}>Phase length</div>
          <div style={S.pcStatN}>{prog.plannedWeeks ? `${prog.week} / ${prog.plannedWeeks}` : `wk ${prog.week}`}</div>
          {pct != null ? (
            <div style={{ ...S.pcTrack, marginTop: 6 }}>
              <div style={{ ...S.pcFill, width: pct + "%", background: color }} />
            </div>
          ) : (
            <div style={{ ...S.pcStatSub, color: dim }}>open-ended</div>
          )}
        </div>
      </div>

      {/* target rate and pace (cuts/maintenance per week, bulks per month) */}
      <div style={S.pcTarget}>{targetText}</div>
      {trend.ready ? (
        pace && (
          <div style={{ ...S.pcPace, color: pace.ok ? accent : "#ffb454" }}>
            {pace.ok ? "●" : "▲"} {pace.text}
            <span style={{ color: dim, fontWeight: 500 }}>
              {" "}· actual {sign(monthly ? trend.pctPerMonth : trend.pctPerWeek, 2)}%/{per}
            </span>
          </div>
        )
      ) : (
        <div style={S.pcNeed}>
          A single weigh-in can swing 1–2 lb on water, salt or a big dinner, so it only
          trusts an average once a 7-day window has at least {TREND_MIN_WEIGHINS} weigh-ins.
          {monthly && " A bulk is judged over 4 weeks."}
          <div style={S.pcNeedCount}>
            This week {Math.min(trend.recentCount, TREND_MIN_WEIGHINS)}/{TREND_MIN_WEIGHINS} ·{" "}
            {monthly
              ? <>4 weeks ago {Math.min(trend.oldCount, TREND_MIN_WEIGHINS)}/{TREND_MIN_WEIGHINS}</>
              : <>last week {Math.min(trend.priorCount, TREND_MIN_WEIGHINS)}/{TREND_MIN_WEIGHINS}</>}
          </div>
        </div>
      )}
      {projection && <div style={S.pcProj}>{projection}</div>}

      <div style={S.viHead}>
        <span>Training volume impact</span>
        <span style={{ color: impactColor, fontWeight: 700 }}>
          {impactR === 0 ? "baseline" : `${sign(impactR, 0)}%`}
        </span>
      </div>
      <div style={S.viBar}>
        <div style={{ ...S.viMarker, left: `calc(${markerPct}% - 7px)` }} />
      </div>
      <div style={S.viScale}>
        <span>−{VOLUME_SCALE}% deficit</span><span>baseline</span><span>+{VOLUME_SCALE}% surplus</span>
      </div>
      <div style={S.viNote}>
        {impactR === 0
          ? "Volume ceilings are at your normal baseline."
          : `Recovery ceilings are ~${Math.abs(impactR)}% ${impactR < 0 ? "below" : "above"} baseline right now. RepReport applies this to your mesos automatically.`}
        {ctx?.estimated && ctx.strength > 0 ? (ctx.kind === "minicut" ? " Assumed at full strength until the weight trend is ready." : " Estimated at half strength until the weight trend is ready.") : ""}
        {ctx?.fading ? ` The last ${KIND_LABEL[ctx.fading.type]} is still fading out (~${ctx.fading.weeksLeft} wk left).` : ""}
      </div>
      {note && <div style={{ ...S.viNote, color: PHASE_COLORS[phase.phase_type] }}>{note}</div>}
    </div>
  );
}

/* ============================================================
   DATE STRIP —"September 16 ›" (opens the month calendar), then the
   Mon–Sun week holding the selected date, each day tinted by the diet
   phase it falls in. Swipe or use the arrows to move a week. Each day
   keeps its copy button underneath, as the old day tabs had.
   ============================================================ */
function DateStrip({ selectedDate, setSelectedDate, dietPhases, onOpenMonth, onCopyDay }) {
  const today = todayISO();
  const monday = mondayOf(selectedDate);
  const days = DAYS.map((key, i) => ({ key, iso: addDaysISO(monday, i) }));
  const current = phaseOnDate(dietPhases, selectedDate);
  const prog = phaseProgress(current, selectedDate);
  const touch = useRef(null);
  const shiftWeek = (n) => setSelectedDate(addDaysISO(selectedDate, 7 * n));
  const title = parseISO(selectedDate).toLocaleDateString("en-US", { month: "long", day: "numeric" });

  return (
    <div
      style={{ marginBottom: 14 }}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touch.current == null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        touch.current = null;
        if (Math.abs(dx) > 50) shiftWeek(dx < 0 ? 1 : -1);
      }}
    >
      <div style={S.dateHead}>
        <button style={S.dateTitle} onClick={onOpenMonth}>
          {title} <span style={{ color: dim }}>›</span>
        </button>
        <div style={{ flex: 1 }} />
        {selectedDate !== today && (
          <button style={S.dateNavBtn} onClick={() => setSelectedDate(today)}>today</button>
        )}
        <button style={S.dateNavBtn} onClick={() => shiftWeek(-1)} aria-label="previous week">‹</button>
        <button style={S.dateNavBtn} onClick={() => shiftWeek(1)} aria-label="next week">›</button>
      </div>
      {/* today's phase is on the card above; the chip only shows when browsing another date */}
      {current && selectedDate !== today && (
        <div style={{ ...S.phaseChip, borderColor: PHASE_COLORS[current.phase_type], color: PHASE_COLORS[current.phase_type] }}>
          {current.phase_name} · week {prog.week}
          {prog.plannedWeeks ? ` of ${prog.plannedWeeks}` : ""}
          {prog.overrun ? " · past planned end" : ""}
        </div>
      )}
      <div style={S.dayRow}>
        {days.map(({ key, iso }) => {
          const ph = phaseOnDate(dietPhases, iso);
          const on = iso === selectedDate;
          return (
            <div key={iso} style={S.dayTabWrap}>
              <button
                onClick={() => setSelectedDate(iso)}
                style={{
                  ...S.dayTab,
                  ...(on ? S.dayTabOn : {}),
                  ...(iso === today && !on ? { color: text } : {}),
                  borderBottom: ph ? `3px solid ${PHASE_COLORS[ph.phase_type]}` : S.dayTab.border,
                }}
              >
                <div style={{ fontSize: 10, letterSpacing: 0.5 }}>{key.toUpperCase()}</div>
                <div style={{ fontSize: 15 }}>{parseISO(iso).getDate()}</div>
              </button>
              <button style={S.dayCopyBtn} onClick={() => onCopyDay(key)} title={`copy ${key}'s meals to…`}>
                ⧉
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   MONTH SHEET — month calendar for jumping to any date, and the one
   place diet phases are planned: every day is tinted by the phase it
   falls in (lighter = future, dashed = past the phase's planned end).
   EDIT PHASES mode turns a tap into "what phase is this day in / start a
   new one here".
   ============================================================ */
function MonthSheet({ selectedDate, dietPhases, presets, onSelectDate, onEdit, onClose }) {
  const today = todayISO();
  const [cursor, setCursor] = useState(() => selectedDate.slice(0, 8) + "01");
  const [editMode, setEditMode] = useState(false);
  const [editDay, setEditDay] = useState(null); // ISO of the day being edited

  const first = parseISO(cursor);
  const gridStart = mondayOf(cursor);
  const cells = Array.from({ length: 42 }, (_, i) => addDaysISO(gridStart, i));
  const shiftMonth = (n) => {
    const d = new Date(first.getFullYear(), first.getMonth() + n, 1);
    setCursor(isoOf(d));
  };

  return (
    <div style={S.modalWrap} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          <button style={S.dateNavBtn} onClick={() => shiftMonth(-1)} aria-label="previous month">‹</button>
          <div style={{ flex: 1, textAlign: "center", fontWeight: 700 }}>
            {first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </div>
          <button style={S.dateNavBtn} onClick={() => shiftMonth(1)} aria-label="next month">›</button>
        </div>
        <div style={{ padding: 12 }}>
          <div style={S.monthGrid}>
            {DAYS.map((d) => (
              <div key={d} style={{ textAlign: "center", fontSize: 11, color: dim, paddingBottom: 4 }}>{d}</div>
            ))}
            {cells.map((iso) => {
              const inMonth = iso.slice(0, 7) === cursor.slice(0, 7);
              const ph = phaseOnDate(dietPhases, iso);
              const color = ph ? PHASE_COLORS[ph.phase_type] : null;
              const future = iso > today;
              const overrun = ph && ph.planned_end_date && iso > ph.planned_end_date;
              const on = iso === (editMode ? editDay : selectedDate);
              return (
                <button
                  key={iso}
                  onClick={() => (editMode ? setEditDay(iso) : onSelectDate(iso))}
                  style={{
                    ...S.monthCell,
                    opacity: inMonth ? 1 : 0.35,
                    background: color ? color + (future ? "22" : "44") : panel2,
                    border: overrun ? `1px dashed ${color}` : on ? `1px solid ${text}` : `1px solid transparent`,
                    boxShadow: iso === today ? `inset 0 0 0 2px ${accent}` : "none",
                    color: on ? text : inMonth ? text : dim,
                    fontWeight: on ? 800 : 500,
                  }}
                >
                  {parseISO(iso).getDate()}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10, fontSize: 11, color: dim }}>
            {[["deficit", "cut"], ["maintenance", "maintenance"], ["surplus", "bulk"]].map(([k, lab]) => (
              <span key={k}><span style={{ color: PHASE_COLORS[k] }}>■</span> {lab}</span>
            ))}
            <span>lighter = planned · dashed = past planned end</span>
          </div>

          <button
            style={{ ...S.ghostBtn, width: "100%", marginTop: 12, ...(editMode ? { color: accent, borderColor: accent } : {}) }}
            onClick={() => { setEditMode(!editMode); setEditDay(null); }}
          >
            {editMode ? "done editing phases" : "edit phases"}
          </button>
          {editMode && !editDay && (
            <p style={{ ...S.note, marginTop: 8, marginBottom: 0 }}>Tap a day to see its phase or start a new phase there.</p>
          )}
          {editMode && editDay && (
            <PhaseDayEditor
              key={editDay}
              day={editDay}
              dietPhases={dietPhases}
              presets={presets}
              onEdit={onEdit}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// The edit panel under the month grid: the phase covering the tapped day
// (change its type, start, planned length, or delete it), or start a new
// phase on that day. A phase runs until its planned end, or until the next
// phase starts — whichever the calendar shows first.
function PhaseDayEditor({ day, dietPhases, presets, onEdit }) {
  const covering = phaseOnDate(dietPhases, day);
  const [mode, setMode] = useState(covering ? "view" : "new");
  const blank = { presetId: "", start: day, weeks: "", openEnded: false, rate: "" }; // rate "" = default
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const typedPresets = presets.filter((p) => p.phase_type);

  const startForm = (row) => {
    if (row) {
      const prog = phaseProgress(row, row.start_date);
      const m = rateIsMonthly(row.phase_type);
      const rate = row.target_rate_pct == null ? "" : String(roundRate(Number(row.target_rate_pct) * (m ? WEEKS_PER_MONTH : 1)).toFixed(2));
      setForm({ presetId: row.phase_id, start: row.start_date, weeks: prog.plannedWeeks || "", openEnded: !row.planned_end_date, rate });
      setMode("edit");
    } else {
      setForm(blank);
      setMode("new");
    }
  };

  const preset = presets.find((p) => p.id === form.presetId) || null;
  const editingId = mode === "edit" ? covering?.id : null;
  // maintenance right after a cut/bulk defaults to the length RP suggests
  const prevBlock = precedingBlock(dietPhases, form.start, editingId ? [editingId] : []);
  const defaultWeeks = preset?.phase_type === "maintenance" ? prevBlock?.maintenanceWeeks || null : defaultPhaseWeeks(preset);
  const weeksValue = form.weeks === "" ? defaultWeeks : Number(form.weeks);
  // the maintenance a cut/bulk gets after it, and the phase (other than
  // that maintenance) already planned to start by then, if any
  const typedBlock = preset && (preset.phase_type === "deficit" || preset.phase_type === "surplus") && !isMiniCut(preset.phase_type, preset.name);
  const plannedEnd = form.openEnded || !weeksValue ? null : addDaysISO(form.start, weeksValue * 7 - 1);
  const autoMaint = typedBlock && plannedEnd ? suggestedMaintenanceWeeks(preset.phase_type, preset.name, weeksValue) : null;
  const ownMaint = mode === "edit" ? followingMaintenance(dietPhases, covering) : null;
  const blockedBy = autoMaint
    ? [...dietPhases]
        .filter((r) => r.id !== editingId && r !== ownMaint && r.start_date > form.start && r.start_date <= addDaysISO(plannedEnd, 1))
        .sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0] || null
    : null;

  // target rate, entered per week (cuts) or per month (bulks); stored per week
  const monthly = preset ? rateIsMonthly(preset.phase_type) : false;
  const rateUnit = monthly ? "%/month" : "%/week";
  const defaultShown = preset ? defaultRatePct(preset.phase_type, preset.name) * (monthly ? WEEKS_PER_MONTH : 1) : 0;
  const rateHint = !preset ? "" : preset.phase_type === "deficit"
    ? "evidence range −0.5 to −1.0 %/week (mini-cuts up to ~−1.25)"
    : preset.phase_type === "surplus"
      ? "by training age: ~1–1.5 beginner · 0.5–1 intermediate · ≤0.5 advanced (%/month)"
      : "";
  const rateWeekly = () => {
    if (!preset || preset.phase_type === "maintenance") return 0;
    if (form.rate === "") return roundRate(defaultRatePct(preset.phase_type, preset.name));
    const n = parseFloat(form.rate);
    return isNaN(n) ? null : roundRate(monthly ? n / WEEKS_PER_MONTH : n);
  };

  const save = async () => {
    if (!preset) return window.alert("pick a phase first");
    const target_rate_pct = rateWeekly();
    if (target_rate_pct == null || Math.abs(target_rate_pct) > 2) return window.alert("enter a target rate between −2 and 2 %/week");
    if (preset.phase_type === "deficit" && target_rate_pct > 0) return window.alert("a cut's target rate should be negative (a loss)");
    if (preset.phase_type === "surplus" && target_rate_pct < 0) return window.alert("a bulk's target rate should be positive (a gain)");
    setSaving(true);
    const ok = await onEdit(async (session) => {
      const fields = { phase_id: preset.id, phase_name: preset.name, phase_type: preset.phase_type, start_date: form.start, planned_end_date: plannedEnd };
      let rows = dietPhases;
      let keepWeeks = null;
      if (mode === "edit") {
        // the maintenance auto-added after this phase moves with it: same
        // length if it was changed by hand, else the new suggestion
        const old = followingMaintenance(dietPhases, covering);
        if (old && old.planned_end_date !== null && (plannedEnd !== covering.planned_end_date || preset.phase_type !== covering.phase_type)) {
          const oldPrev = precedingBlock(dietPhases, old.start_date, [old.id]);
          const oldWeeks = Math.round((daysBetween(old.start_date, old.planned_end_date) + 1) / 7);
          if (oldPrev?.maintenanceWeeks && oldWeeks !== oldPrev.maintenanceWeeks) keepWeeks = oldWeeks;
          await sbDeleteDietPhase(session, old.id);
          rows = rows.filter((r) => r.id !== old.id);
        }
        await sbUpdateDietPhase(session, covering.id, {
          ...fields,
          end_date: covering.end_date && covering.end_date < form.start ? null : covering.end_date,
          target_rate_pct,
        });
        if (rows !== dietPhases || covering.planned_end_date !== plannedEnd) {
          await sbAddMaintenanceAfter(session, rows, { ...covering, ...fields }, presets, keepWeeks);
        }
      } else {
        await sbInsertDietPhase(session, { preset, ...fields, target_rate_pct });
        await sbAddMaintenanceAfter(session, rows, { id: null, ...fields }, presets);
      }
    });
    setSaving(false);
    if (ok) setMode("view");
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${covering.phase_name} (from ${covering.start_date})?`)) return;
    await onEdit((session) => sbDeleteDietPhase(session, covering.id));
  };

  const dayLabel = parseISO(day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  if (mode === "view" && covering) {
    const prog = phaseProgress(covering, day);
    const viewNote = transitionNote(dietPhases, covering.start_date, covering.phase_type, prog.plannedWeeks, [covering.id]);
    return (
      <div style={{ ...S.phaseCard, marginTop: 12 }}>
        <div style={{ fontSize: 11, color: dim, letterSpacing: 1 }}>{dayLabel.toUpperCase()}</div>
        <div style={{ fontWeight: 700, color: PHASE_COLORS[covering.phase_type], marginTop: 4 }}>
          {covering.phase_name} · week {prog.week}{prog.plannedWeeks ? ` of ${prog.plannedWeeks}` : ""}
        </div>
        <div style={{ fontSize: 12, color: dim, marginTop: 2 }}>
          from {covering.start_date}
          {covering.planned_end_date ? ` · planned to ${covering.planned_end_date}` : " · open-ended"}
          {covering.end_date ? ` · ended ${covering.end_date}` : ""}
        </div>
        <div style={{ fontSize: 12, color: dim, marginTop: 2 }}>
          {covering.phase_type === "maintenance"
            ? "target: hold weight"
            : `target: ${(phaseRatePct(covering) * (rateIsMonthly(covering.phase_type) ? WEEKS_PER_MONTH : 1)).toFixed(2).replace("-", "−")} ${rateIsMonthly(covering.phase_type) ? "%/month" : "%/week"}`}
        </div>
        {viewNote && <div style={{ fontSize: 12, color: PHASE_COLORS[covering.phase_type], marginTop: 6 }}>{viewNote}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button style={{ ...S.ghostBtn, flex: 1 }} onClick={() => startForm(covering)}>edit</button>
          <button style={{ ...S.ghostBtn, flex: 1 }} onClick={() => startForm(null)}>new phase here</button>
          <button style={{ ...S.ghostBtn, color: "#ff5d7a" }} onClick={remove}>delete</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...S.phaseCard, marginTop: 12 }}>
      <div style={{ fontSize: 11, color: dim, letterSpacing: 1, marginBottom: 8 }}>
        {mode === "edit" ? "EDIT PHASE" : `NEW PHASE FROM ${dayLabel.toUpperCase()}`}
      </div>
      <select
        value={form.presetId}
        onChange={(e) => setForm({ ...form, presetId: e.target.value, weeks: "", rate: "" })}
        style={{ ...S.fInput, width: "100%", marginBottom: 8 }}
      >
        <option value="" disabled>phase…</option>
        {typedPresets.map((p) => (
          <option key={p.id} value={p.id}>{p.name} ({p.phase_type})</option>
        ))}
      </select>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: dim, width: 64 }}>starts</label>
        <input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} style={{ ...S.fInput, flex: 1 }} />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: dim, width: 64 }}>weeks</label>
        <input
          type="number" min="1" inputMode="numeric"
          disabled={form.openEnded}
          placeholder={defaultWeeks ? String(defaultWeeks) : "—"}
          value={form.weeks}
          onChange={(e) => setForm({ ...form, weeks: e.target.value })}
          style={{ ...S.fInput, flex: 1 }}
        />
        <label style={{ fontSize: 12, color: dim, display: "flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" checked={form.openEnded} onChange={(e) => setForm({ ...form, openEnded: e.target.checked })} />
          open-ended
        </label>
      </div>
      <div style={{ fontSize: 12, color: dim, marginBottom: 10 }}>
        {plannedEnd ? `planned end: ${plannedEnd}` : "no planned end — runs until the next phase starts"}
        {autoMaint
          ? blockedBy
            ? ` · ${blockedBy.phase_name} is already planned right after, so no maintenance is added (suggested: ~${autoMaint} wk)`
            : ` · then ~${autoMaint} wk maintenance is added after it`
          : ""}
      </div>
      {preset && transitionNote(dietPhases, form.start, preset.phase_type, weeksValue, editingId ? [editingId] : []) && (
        <div style={{ fontSize: 12, color: PHASE_COLORS[preset.phase_type], marginBottom: 10 }}>
          {transitionNote(dietPhases, form.start, preset.phase_type, weeksValue, editingId ? [editingId] : [])}
        </div>
      )}
      {preset && preset.phase_type !== "maintenance" && (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
            <label style={{ fontSize: 12, color: dim, width: 64 }}>target</label>
            <input
              type="number" step="0.05" inputMode="decimal"
              placeholder={defaultShown.toFixed(2)}
              value={form.rate}
              onChange={(e) => setForm({ ...form, rate: e.target.value })}
              style={{ ...S.fInput, flex: 1 }}
            />
            <span style={{ fontSize: 12, color: dim, width: 64 }}>{rateUnit}</span>
          </div>
          <div style={{ fontSize: 11, color: dim, marginBottom: 10 }}>
            {form.rate === "" ? `default ${defaultShown.toFixed(2)} ${rateUnit} · ` : ""}{rateHint}
          </div>
        </>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button style={{ ...S.primaryBtn, flex: 1 }} onClick={save} disabled={saving}>{saving ? "saving…" : "save"}</button>
        {(covering || mode === "edit") && (
          <button style={{ ...S.ghostBtn, flex: 1 }} onClick={() => setMode(covering ? "view" : "new")}>cancel</button>
        )}
      </div>
    </div>
  );
}

function MacroBars({ total, target }) {
  const rows = [
    ["Protein", "p", "#46e6a0"],
    ["Fat", "f", "#ffb454"],
    ["Carbs", "c", "#5db4ff"],
    ["Calories", "cal", "#ff5d7a"],
  ];
  return (
    <div style={S.bars}>
      {rows.map(([label, key, color]) => {
        const have = total[key];
        const goal = target ? target[key] : 0;
        const pct = goal ? Math.min(100, (have / goal) * 100) : 0;
        const over = goal && have > goal;
        return (
          <div key={key} style={S.barRow}>
            <div style={S.barTop}>
              <span style={S.barLabel}>{label}</span>
              <span style={S.barNums}>
                <b style={{ color }}>{key === "cal" ? r0(have) : r1(have)}</b>
                {target && (
                  <span style={S.barGoal}>
                    {" "}
                    / {key === "cal" ? r0(goal) : r1(goal)}
                  </span>
                )}
              </span>
            </div>
            {target && (
              <div style={S.barTrack}>
                <div
                  style={{
                    ...S.barFill,
                    width: pct + "%",
                    background: over ? "#ff5d7a" : color,
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Slot({
  slot,
  foods,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onRename,
  onRemoveSlot,
  onCopyNext,
  canCopyNext,
  onAdd,
  onScan,
  onQty,
  onRemoveEntry,
  loggable,     // date is today/past and its log has loaded — show the check circle
  logged,       // this meal's food-log rows for the date, or null if not checked off
  onCheck,
  onUncheck,
  onLogQty,
  onLogRemove,
  onQuickAdd,   // logged meals only: one-off entry for this day
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const planTotal = useMemo(() => {
    let t = ZERO;
    for (const e of slot.entries) {
      const food = foods.find((x) => x.id === e.foodId);
      if (food) t = addM(t, scale(foodMacros(food, foods), e.qty));
    }
    return t;
  }, [slot, foods]);
  const total = logged ? intakeTotal(logged) : planTotal;
  const canCheck = slot.entries.some((e) => foods.some((x) => x.id === e.foodId));

  return (
    <div style={{ ...S.slot, ...(logged ? S.slotLogged : {}) }}>
      <div style={S.slotHead}>
        {loggable && (
          <button
            style={{ ...S.checkBtn, ...(logged ? S.checkBtnOn : {}), opacity: logged || canCheck ? 1 : 0.3 }}
            disabled={!logged && !canCheck}
            onClick={logged ? onUncheck : onCheck}
            title={logged ? "logged — tap to remove from this day's log" : "ate this as planned — log it"}
            aria-label={logged ? `unlog ${slot.name}` : `log ${slot.name} as eaten`}
          >
            {logged ? "✓" : ""}
          </button>
        )}
        <div style={S.moveButtons}>
          <button
            style={{...S.moveBtn, opacity: isFirst ? 0.2 : 1}}
            onClick={onMoveUp}
            disabled={isFirst}
            title="move up"
          >▲</button>
          <button
            style={{...S.moveBtn, opacity: isLast ? 0.2 : 1}}
            onClick={onMoveDown}
            disabled={isLast}
            title="move down"
          >▼</button>
        </div>
        <input
          value={slot.name}
          onChange={(e) => onRename(e.target.value)}
          style={S.slotName}
        />
        <span style={S.slotMacros}>
          {r0(total.cal)} kcal · {r1(total.p)}P · {r1(total.f)}F · {r1(total.c)}C
        </span>
        <div style={{ position: "relative" }}>
          <button style={S.xBtn} onClick={() => setMenuOpen((v) => !v)} title="meal options">
            ⋮
          </button>
          {menuOpen && (
            <>
              <div style={S.menuBackdrop} onClick={() => setMenuOpen(false)} />
              <div style={S.slotMenu}>
                <button
                  style={{ ...S.slotMenuItem, opacity: canCopyNext ? 1 : 0.4 }}
                  disabled={!canCopyNext}
                  onClick={() => {
                    setMenuOpen(false);
                    onCopyNext();
                  }}
                >
                  ⧉ copy to next day
                </button>
                <button
                  style={{ ...S.slotMenuItem, color: "#ff5d7a" }}
                  onClick={() => {
                    setMenuOpen(false);
                    onRemoveSlot();
                  }}
                >
                  ✕ delete meal
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {logged && (
        <>
          <div style={S.loggedNote}>logged for this day · edits here change the log, not your plan</div>
          {logged.map((r) => (
            <LogEntry key={r.id} row={r} onQty={(q) => onLogQty(r.id, q)} onRemove={() => onLogRemove(r.id)} />
          ))}
        </>
      )}

      {!logged && slot.entries.map((e, ei) => {
        const food = foods.find((x) => x.id === e.foodId);
        if (!food) return null;
        const m = scale(foodMacros(food, foods), e.qty);
        return (
          <div key={ei} style={S.entry}>
            <input
              type="number"
              step="0.25"
              value={e.qty}
              onChange={(ev) => onQty(ei, parseFloat(ev.target.value) || 0)}
              style={S.qty}
            />
            <span style={S.entryUnit}>{food.unit}</span>
            <span style={S.entryName}>
              {food.name}
              {food.verify && <span style={S.verifyDot} title="verify macros">●</span>}
              {food.type === "recipe" && <span style={S.recipeTag}>recipe</span>}
            </span>
            <span style={S.entryMacros}>
              {r0(m.cal)} · {r1(m.p)}P
            </span>
            <button style={S.xBtnSm} onClick={() => onRemoveEntry(ei)}>
              ✕
            </button>
          </div>
        );
      })}

      {logged && (
        <button style={S.addEntry} onClick={onQuickAdd}>
          + quick add
        </button>
      )}
      <button style={S.addEntry} onClick={onAdd}>
        + food
      </button>
      <button style={S.addEntry} onClick={onScan}>
        + scan barcode
      </button>
    </div>
  );
}

// one food-log row: the amount saves when the field loses focus (or Enter),
// not on every keystroke, so typing "1.5" isn't three writes
function LogEntry({ row, onQty, onRemove }) {
  const [qty, setQty] = useState(String(row.qty));
  useEffect(() => setQty(String(row.qty)), [row.qty]);
  const commit = () => {
    const n = parseFloat(qty);
    if (isNaN(n) || n < 0) return setQty(String(row.qty));
    if (n !== Number(row.qty)) onQty(n);
  };
  const m = scale({ p: Number(row.p), f: Number(row.f), c: Number(row.c), cal: Number(row.cal) }, Number(row.qty));
  const calOnly = row.p == null && row.f == null && row.c == null;
  return (
    <div style={S.entry}>
      <input
        type="number"
        step="0.25"
        inputMode="decimal"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
        style={S.qty}
      />
      <span style={S.entryUnit}>{row.unit}</span>
      <span style={S.entryName}>
        {row.food_name}
        {row.source === "quick" && <span style={S.recipeTag}>quick</span>}
      </span>
      <span style={S.entryMacros}>{r0(m.cal)} · {calOnly ? "cal only" : `${r1(m.p)}P`}</span>
      <button style={S.xBtnSm} onClick={onRemove} aria-label={`remove ${row.food_name} from log`}>✕</button>
    </div>
  );
}

/* Quick Add — log a one-off to this day without creating a saved food
   (MacroFactor-style). Calories fill in from the macros (4/4/9) until
   edited by hand; calories alone are allowed, leaving the macros unknown.
   "Save to my foods" also adds it to the library for next time. */
function QuickAddModal({ onClose, onLog }) {
  const [name, setName] = useState("");
  const [mac, setMac] = useState({ p: "", c: "", f: "" });
  const [calText, setCalText] = useState("");
  const [calTouched, setCalTouched] = useState(false);
  const [saveFood, setSaveFood] = useState(false);
  const [err, setErr] = useState("");

  const num = (v) => (v === "" ? null : parseFloat(v));
  const p = num(mac.p), c = num(mac.c), f = num(mac.f);
  const anyMacro = p != null || c != null || f != null;
  const autoCal = Math.round(4 * (p || 0) + 4 * (c || 0) + 9 * (f || 0));
  const calShown = calTouched ? calText : anyMacro ? String(autoCal) : "";
  const cal = parseFloat(calShown);

  const submit = () => {
    if ([p, c, f].some((v) => v != null && (isNaN(v) || v < 0))) return setErr("macros must be 0 or more");
    if (isNaN(cal) || cal <= 0) return setErr("enter calories, or some macros");
    if (saveFood && !name.trim()) return setErr("give it a name to save it to your foods");
    onLog({
      name: name.trim(),
      // calories-only: macros unknown (null); otherwise blanks count as 0
      p: anyMacro ? p || 0 : null, f: anyMacro ? f || 0 : null, c: anyMacro ? c || 0 : null,
      cal, saveFood,
    });
  };

  return (
    <div style={S.modalWrap} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          <strong style={{ fontSize: 13, letterSpacing: 1 }}>QUICK ADD</strong>
          <button style={S.xBtn} onClick={onClose}>✕</button>
        </div>
        <div style={S.editorBody}>
          <label style={S.fLabel}>Name (optional)</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} style={S.fInput} placeholder="e.g. restaurant burrito" />
          <label style={S.fLabel}>Macros (optional)</label>
          <div style={S.macroGrid}>
            {[["Protein", "p"], ["Carbs", "c"], ["Fat", "f"]].map(([lab, k]) => (
              <div key={k}>
                <span style={S.macroMini}>{lab} (g)</span>
                <input
                  type="number" step="1" inputMode="decimal" value={mac[k]}
                  onChange={(e) => { setMac({ ...mac, [k]: e.target.value }); setErr(""); }}
                  style={S.fInput}
                />
              </div>
            ))}
            <div>
              <span style={S.macroMini}>Calories{calTouched || !anyMacro ? "" : " (auto)"}</span>
              <input
                type="number" step="1" inputMode="decimal" value={calShown}
                onChange={(e) => { setCalText(e.target.value); setCalTouched(true); setErr(""); }}
                style={S.fInput}
              />
            </div>
          </div>
          <div style={{ fontSize: 11, color: dim, marginTop: 6 }}>
            {anyMacro ? "Calories fill in from your macros — edit to override." : "Only know the calories? Enter just those; protein stays unknown."}
          </div>
          <label style={S.checkRow}>
            <input type="checkbox" checked={saveFood} onChange={(e) => setSaveFood(e.target.checked)} />
            <span>also save to my foods</span>
          </label>
          {err && <div style={{ color: "#ff5d7a", fontSize: 12, marginTop: 6 }}>{err}</div>}
        </div>
        <div style={S.editorFoot}>
          <div style={{ flex: 1 }} />
          <button style={S.ghostBtn} onClick={onClose}>cancel</button>
          <button style={S.primaryBtn} onClick={submit}>log it</button>
        </div>
      </div>
    </div>
  );
}

function FoodPicker({ foods, onPick, onClose, onCreateFood }) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(blankQuickFood());
  const [lastAddedId, setLastAddedId] = useState(null);

  const list = foods
    .filter((f) => f.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const startAdd = () => {
    setDraft({ ...blankQuickFood(), name: q.trim() });
    setAdding(true);
  };

  const setMacro = (k, v) =>
    setDraft((d) => ({ ...d, macros: { ...d.macros, [k]: parseFloat(v) || 0 } }));

  const saveNewFood = () => {
    if (!draft.name.trim() || !onCreateFood) return;
    const food = onCreateFood(draft);
    setLastAddedId(food.id);
    setAdding(false);
  };

  return (
    <div style={S.modalWrap} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          {onCreateFood && !adding && (
            <button style={S.headerAddBtn} onClick={startAdd} title="add new food">
              +
            </button>
          )}
          <input
            autoFocus
            placeholder="search foods…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={S.search}
            disabled={adding}
          />
          <button style={S.xBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        {!adding ? (
          <div style={S.modalList}>
            {list.map((f) => (
              <button key={f.id} style={S.pickItem} onClick={() => onPick(f.id)}>
                <span>
                  {f.name}
                  {f.verify && <span style={S.verifyDot}>●</span>}
                  {f.type === "recipe" && <span style={S.recipeTag}>recipe</span>}
                  {f.id === lastAddedId && <span style={S.newTag}>just added</span>}
                </span>
                <span style={S.pickUnit}>per {f.unit}</span>
              </button>
            ))}
            {list.length === 0 && (
              <div style={S.empty}>
                no match
                {onCreateFood && (
                  <div style={{ marginTop: 10 }}>
                    <button style={S.quickAddRow} onClick={startAdd}>
                      + add it as a new food
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div style={S.editorBody}>
            <strong style={{ fontSize: 12, letterSpacing: 1, color: dim }}>
              NEW COMPONENT
            </strong>

            <label style={S.fLabel}>Name</label>
            <input
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              style={S.fInput}
              placeholder="e.g. protein bar"
            />

            <label style={S.fLabel}>Unit</label>
            <input
              value={draft.unit}
              onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))}
              style={S.fInput}
              placeholder="oz / cup / bar"
            />

            <label style={S.fLabel}>Macros (per {draft.unit || "unit"})</label>
            <div style={S.macroGrid}>
              {[
                ["Protein", "p"],
                ["Fat", "f"],
                ["Carbs", "c"],
                ["Calories", "cal"],
              ].map(([lab, k]) => (
                <div key={k}>
                  <span style={S.macroMini}>{lab}</span>
                  <input
                    type="number"
                    step="0.1"
                    value={draft.macros[k]}
                    onChange={(e) => setMacro(k, e.target.value)}
                    style={S.fInput}
                  />
                </div>
              ))}
            </div>

            <label style={S.checkRow}>
              <input
                type="checkbox"
                checked={draft.verify}
                onChange={(e) => setDraft((d) => ({ ...d, verify: e.target.checked }))}
              />
              <span>flag "needs verification"</span>
            </label>

            <div style={S.editorFoot}>
              <div style={{ flex: 1 }} />
              <button style={S.ghostBtn} onClick={() => setAdding(false)}>
                cancel
              </button>
              <button
                style={{ ...S.primaryBtn, opacity: draft.name.trim() ? 1 : 0.5 }}
                disabled={!draft.name.trim()}
                onClick={saveNewFood}
              >
                save to foods
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function blankQuickFood() {
  return { name: "", unit: "unit", macros: { p: 0, f: 0, c: 0, cal: 0 }, verify: false };
}

function CopyDayModal({ sourceDay, days, onClose, onApply }) {
  const idx = days.indexOf(sourceDay);
  const nextDay = idx < days.length - 1 ? days[idx + 1] : null;
  const restOfWeek = days.slice(idx + 1); // empty on Sun — nothing left to fill
  const otherDays = days.filter((d) => d !== sourceDay);
  const [picked, setPicked] = useState([]);
  const [copyTarget, setCopyTarget] = useState(false);

  const toggle = (d) =>
    setPicked((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]));

  const apply = (targets) => targets.length > 0 && onApply(targets, copyTarget);

  return (
    <div style={S.modalWrap} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>
            copy {sourceDay}'s meals to…
          </span>
          <button style={S.xBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={S.modalList}>
          {nextDay ? (
            <button style={S.pickItem} onClick={() => apply([nextDay])}>
              <span>→ Next day ({nextDay})</span>
            </button>
          ) : (
            <div style={S.empty}>already on the last day of the week</div>
          )}

          {restOfWeek.length > 0 && (
            <button style={S.pickItem} onClick={() => apply(restOfWeek)}>
              <span>→ Rest of week ({restOfWeek.join(", ")})</span>
            </button>
          )}

          <div style={{ ...S.dashLabel, padding: "12px 10px 4px" }}>
            OR PICK DAY(S)
          </div>
          {otherDays.map((d) => (
            <label key={d} style={{ ...S.pickItem, cursor: "pointer" }}>
              <span>{d}</span>
              <input type="checkbox" checked={picked.includes(d)} onChange={() => toggle(d)} />
            </label>
          ))}

          <label style={{ ...S.pickItem, cursor: "pointer", marginTop: 4 }}>
            <span>also copy its targets override</span>
            <input
              type="checkbox"
              checked={copyTarget}
              onChange={(e) => setCopyTarget(e.target.checked)}
            />
          </label>

          <button
            style={{ ...S.addSlot, marginTop: 8, opacity: picked.length ? 1 : 0.5 }}
            disabled={picked.length === 0}
            onClick={() => apply(picked)}
          >
            copy to {picked.length || ""} selected day{picked.length === 1 ? "" : "s"}
          </button>
        </div>

        <div style={{ padding: "0 12px 12px", fontSize: 11, color: dim }}>
          this replaces existing meals on the target day(s) — can't be undone.
        </div>
      </div>
    </div>
  );
}

/* ---------- Open Food Facts barcode lookup (no key, no auth) ---------- */
async function lookupOpenFoodFacts(barcode) {
  const res = await fetch(
    `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`
  );
  const data = await res.json();
  // OFF returns HTTP 200 even for a miss — status must be checked, not the HTTP code.
  if (data.status !== 1 || !data.product) return null;
  const p = data.product;
  const n = p.nutriments || {};
  const hasServing = n["energy-kcal_serving"] != null;
  return {
    name: p.product_name || p.generic_name || `Scanned item (${barcode})`,
    unit: hasServing ? p.serving_size || "serving" : "100g",
    macros: hasServing
      ? {
          p: n.proteins_serving ?? 0,
          f: n.fat_serving ?? 0,
          c: n.carbohydrates_serving ?? 0,
          cal: n["energy-kcal_serving"] ?? 0,
        }
      : {
          p: n.proteins_100g ?? 0,
          f: n.fat_100g ?? 0,
          c: n.carbohydrates_100g ?? 0,
          cal: n["energy-kcal_100g"] ?? 0,
        },
  };
}

/* camera modal — scans one barcode then hands it off. Loads the decoder
   from a CDN at scan-time (not a project dependency), since Safari/iOS has
   no native BarcodeDetector and this needs to work regardless of build setup. */
function BarcodeScanner({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const [status, setStatus] = useState("loading"); // loading | scanning | error
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import(
          "https://esm.sh/@zxing/browser@0.2.1"
        );
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader();
        setStatus("scanning");
        const controls = await reader.decodeFromVideoDevice(
          undefined, // default camera — prefers rear ("environment") on phones
          videoRef.current,
          (result, err, ctrls) => {
            if (result) {
              ctrls.stop();
              onDetected(result.getText());
            }
          }
        );
        if (cancelled) {
          // modal was closed while the camera was still being allocated —
          // release it immediately instead of leaving an orphaned stream
          // holding the hardware (that's what breaks the *next* scan attempt).
          controls.stop();
          return;
        }
        controlsRef.current = controls;
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setErrMsg(e.message || "camera access failed");
        }
      }
    })();
    return () => {
      cancelled = true;
      controlsRef.current?.stop();
    };
  }, []);

  return (
    <div style={S.modalWrap} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          <strong style={{ fontSize: 13, letterSpacing: 1 }}>SCAN BARCODE</strong>
          <button style={S.xBtn} onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: 16 }}>
          {status === "error" ? (
            <div style={S.verifyBanner}>{errMsg || "Couldn't access the camera."}</div>
          ) : (
            <video
              ref={videoRef}
              muted
              playsInline
              style={{ width: "100%", borderRadius: 10, background: "#000" }}
            />
          )}
          {status === "loading" && (
            <div style={{ ...S.empty, padding: "10px 0" }}>loading scanner…</div>
          )}
          {status === "scanning" && (
            <div style={{ ...S.empty, padding: "10px 0" }}>point the camera at a barcode</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* lookup + confirm — shown once a barcode is decoded. Reuses an existing
   food by barcode if this item's been scanned before; otherwise looks it
   up and lets you review/correct the macros before it's logged. */
function ScanConfirm({ barcode, foods, onClose, onConfirm }) {
  const existing = foods.find((x) => x.barcode === barcode);
  const [status, setStatus] = useState(existing ? "ready" : "looking"); // looking | ready | notfound | error
  const [errMsg, setErrMsg] = useState("");
  const [draft, setDraft] = useState(
    existing
      ? { name: existing.name, unit: existing.unit, macros: existing.macros }
      : null
  );
  const [qty, setQty] = useState(1);

  useEffect(() => {
    if (existing) return;
    let cancelled = false;
    (async () => {
      try {
        const found = await lookupOpenFoodFacts(barcode);
        if (cancelled) return;
        if (!found) {
          setStatus("notfound");
          return;
        }
        setDraft(found);
        setStatus("ready");
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setErrMsg(e.message || "lookup failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [barcode]);

  const setMacro = (k, v) =>
    setDraft((d) => ({ ...d, macros: { ...d.macros, [k]: parseFloat(v) || 0 } }));

  return (
    <div style={S.modalWrap} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          <strong style={{ fontSize: 13, letterSpacing: 1 }}>
            {existing ? "LOG SCANNED ITEM" : "NEW SCANNED ITEM"}
          </strong>
          <button style={S.xBtn} onClick={onClose}>✕</button>
        </div>

        <div style={S.editorBody}>
          {status === "looking" && <div style={S.empty}>looking up {barcode}…</div>}
          {status === "notfound" && (
            <div style={S.verifyBanner}>
              No match for {barcode} in Open Food Facts. Add it manually via + food instead.
            </div>
          )}
          {status === "error" && <div style={S.verifyBanner}>{errMsg}</div>}

          {draft && (
            <>
              <label style={S.fLabel}>Name</label>
              <input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                style={S.fInput}
              />
              <label style={S.fLabel}>Macros (per {draft.unit})</label>
              <div style={S.macroGrid}>
                {[
                  ["Protein", "p"],
                  ["Fat", "f"],
                  ["Carbs", "c"],
                  ["Calories", "cal"],
                ].map(([lab, k]) => (
                  <div key={k}>
                    <span style={S.macroMini}>{lab}</span>
                    <input
                      type="number"
                      step="0.1"
                      value={draft.macros[k]}
                      onChange={(e) => setMacro(k, e.target.value)}
                      style={S.fInput}
                    />
                  </div>
                ))}
              </div>
              <label style={S.fLabel}>Qty ({draft.unit})</label>
              <input
                type="number"
                step="0.25"
                value={qty}
                onChange={(e) => setQty(parseFloat(e.target.value) || 1)}
                style={S.fInput}
              />
            </>
          )}
        </div>

        <div style={S.editorFoot}>
          <div style={{ flex: 1 }} />
          <button style={S.ghostBtn} onClick={onClose}>
            cancel
          </button>
          {draft && (
            <button
              style={S.primaryBtn}
              onClick={() => onConfirm({ draft, qty, existingId: existing?.id })}
            >
              log it
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   FOODS
   ============================================================ */
function Foods({ foods, setFoods }) {
  const [editing, setEditing] = useState(null); // food id or "new-component"/"new-recipe"
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState("newest"); // "newest" | "alpha" | "verify"

  const list = foods
    .filter((f) => f.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "newest") {
        // preserve array order (newest last), then reverse so newest first
        return foods.indexOf(b) - foods.indexOf(a);
      }
      if (sortBy === "verify") {
        if (a.verify !== b.verify) return a.verify ? -1 : 1;
        return a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name); // alpha
    });

  const save = (food) => {
    setFoods((prev) => {
      const i = prev.findIndex((x) => x.id === food.id);
      if (i === -1) return [...prev, food];
      const copy = [...prev];
      copy[i] = food;
      return copy;
    });
    setEditing(null);
  };
  const del = (id) => setFoods((prev) => prev.filter((x) => x.id !== id));

  const verifyCount = foods.filter((f) => f.verify).length;

  return (
    <div>

      <div style={S.foodsHead}>
        <input
          placeholder="search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={S.search}
        />
        <button
          style={S.primaryBtn}
          onClick={() => setEditing({ ...blankFood("component") })}
        >
          + component
        </button>
        <button
          style={S.primaryBtn}
          onClick={() => setEditing({ ...blankFood("recipe") })}
        >
          + recipe
        </button>
      </div>
      <div style={{display:"flex",gap:4,marginBottom:10}}>
        {[["newest","Recent"],["alpha","A–Z"],["verify","Verify ●"]].map(([k,label])=>(
          <button key={k} onClick={()=>setSortBy(k)}
            style={{...S.navBtn, flex:"0 auto", padding:"6px 12px", fontSize:11,
              ...(sortBy===k?{background:"#46e6a0",color:"#0c0e0d",borderColor:"#46e6a0"}:{})
            }}>{label}</button>
        ))}
      </div>

      {verifyCount > 0 && (
        <div style={S.verifyBanner}>
          <span style={S.verifyDot}>●</span> {verifyCount} seeded foods have
          best-effort macros — tap to verify against your brands & numbers.
        </div>
      )}

      <div style={S.foodGrid}>
        {list.map((food) => {
          const m = foodMacros(food, foods);
          return (
            <div key={food.id} style={S.foodCard} onClick={() => setEditing(food)}>
              <div style={S.foodCardTop}>
                <span style={S.foodCardName}>
                  {food.name}
                  {food.verify && <span style={S.verifyDot}>●</span>}
                </span>
                {food.type === "recipe" && (
                  <span style={S.recipeTag}>recipe ÷{food.servings}</span>
                )}
              </div>
              <div style={S.foodCardMacros}>
                <span>{r0(m.cal)} kcal</span>
                <span>{r1(m.p)}P</span>
                <span>{r1(m.f)}F</span>
                <span>{r1(m.c)}C</span>
                <span style={S.foodCardUnit}>/ {food.unit}</span>
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <FoodEditor
          food={editing}
          foods={foods}
          onSave={save}
          onDelete={del}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function blankFood(type) {
  return {
    id: uid(),
    name: "",
    unit: type === "recipe" ? "serving" : "unit",
    type,
    macros: { p: 0, f: 0, c: 0, cal: 0 },
    verify: false,
    ingredients: [],
    servings: type === "recipe" ? 6 : 1,
  };
}

function FoodEditor({ food, foods, onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(food)));
  const [picking, setPicking] = useState(false);
  const isRecipe = draft.type === "recipe";
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setMacro = (k, v) =>
    setDraft((d) => ({ ...d, macros: { ...d.macros, [k]: parseFloat(v) || 0 } }));

  const computed = isRecipe ? foodMacros(draft, foods) : draft.macros;
  const exists = foods.some((x) => x.id === food.id);

  return (
    <div style={S.modalWrap} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          <strong style={{ fontSize: 13, letterSpacing: 1 }}>
            {exists ? "EDIT" : "NEW"} {isRecipe ? "RECIPE" : "COMPONENT"}
          </strong>
          <button style={S.xBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={S.editorBody}>
          <label style={S.fLabel}>Name</label>
          <input
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            style={S.fInput}
            placeholder="e.g. chicken breast"
          />

          <div style={S.fRow}>
            <div style={{ flex: 1 }}>
              <label style={S.fLabel}>Unit</label>
              <input
                value={draft.unit}
                onChange={(e) => set("unit", e.target.value)}
                style={S.fInput}
                placeholder="oz / cup / serving"
              />
            </div>
            {isRecipe && (
              <div style={{ width: 110 }}>
                <label style={S.fLabel}>Servings</label>
                <input
                  type="number"
                  value={draft.servings}
                  onChange={(e) =>
                    set("servings", parseFloat(e.target.value) || 1)
                  }
                  style={S.fInput}
                />
              </div>
            )}
          </div>

          {!isRecipe ? (
            <>
              <label style={S.fLabel}>Macros (per {draft.unit || "unit"})</label>
              <div style={S.macroGrid}>
                {[
                  ["Protein", "p"],
                  ["Fat", "f"],
                  ["Carbs", "c"],
                  ["Calories", "cal"],
                ].map(([lab, k]) => (
                  <div key={k}>
                    <span style={S.macroMini}>{lab}</span>
                    <input
                      type="number"
                      step="0.1"
                      value={draft.macros[k]}
                      onChange={(e) => setMacro(k, e.target.value)}
                      style={S.fInput}
                    />
                  </div>
                ))}
              </div>
              <label style={S.checkRow}>
                <input
                  type="checkbox"
                  checked={draft.verify}
                  onChange={(e) => set("verify", e.target.checked)}
                />
                <span>flag "needs verification"</span>
              </label>
            </>
          ) : (
            <>
              <label style={S.fLabel}>Ingredients</label>
              {draft.ingredients.map((ing, i) => {
                const base = foods.find((x) => x.id === ing.foodId);
                return (
                  <div key={i} style={S.ingRow}>
                    <input
                      type="number"
                      step="0.25"
                      value={ing.qty}
                      onChange={(e) => {
                        const q = parseFloat(e.target.value) || 0;
                        setDraft((d) => {
                          const ings = [...d.ingredients];
                          ings[i] = { ...ings[i], qty: q };
                          return { ...d, ingredients: ings };
                        });
                      }}
                      style={S.qty}
                    />
                    <span style={S.entryUnit}>{base ? base.unit : "?"}</span>
                    <span style={S.entryName}>
                      {base ? base.name : "(deleted food)"}
                    </span>
                    <button
                      style={S.xBtnSm}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          ingredients: d.ingredients.filter((_, j) => j !== i),
                        }))
                      }
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              <button style={S.addEntry} onClick={() => setPicking(true)}>
                + ingredient
              </button>

              <div style={S.recipeTotal}>
                <span style={S.fLabel}>Per serving (auto)</span>
                <div style={S.foodCardMacros}>
                  <span>{r0(computed.cal)} kcal</span>
                  <span>{r1(computed.p)}P</span>
                  <span>{r1(computed.f)}F</span>
                  <span>{r1(computed.c)}C</span>
                </div>
              </div>
              <label style={S.checkRow}>
                <input
                  type="checkbox"
                  checked={draft.verify}
                  onChange={(e) => set("verify", e.target.checked)}
                />
                <span>flag "needs verification"</span>
              </label>
            </>
          )}
        </div>

        <div style={S.editorFoot}>
          {exists && (
            <button
              style={S.dangerBtn}
              onClick={() => {
                onDelete(draft.id);
                onClose();
              }}
            >
              delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button style={S.ghostBtn} onClick={onClose}>
            cancel
          </button>
          <button
            style={S.primaryBtn}
            onClick={() => draft.name.trim() && onSave(draft)}
          >
            save
          </button>
        </div>

        {picking && (
          <FoodPicker
            foods={foods.filter((x) => x.id !== draft.id)}
            onClose={() => setPicking(false)}
            onPick={(foodId) => {
              setDraft((d) => ({
                ...d,
                ingredients: [...d.ingredients, { foodId, qty: 1 }],
              }));
              setPicking(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ============================================================
   PHASES
   ============================================================ */
/* ============================================================
   BODYWEIGHT MODAL — once-daily prompt (no dismiss-outside; save or skip)
   ============================================================ */
function BodyweightModal({ onSave, onSkip }) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const n = parseFloat(val);
    if (!val || isNaN(n) || n <= 0) {
      setErr("enter a weight first");
      return;
    }
    setErr("");
    setSaving(true);
    await onSave(n);
    setSaving(false);
  };

  return (
    <div style={S.modalWrap}>
      <div style={{ ...S.modal, maxWidth: 320 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: 24, textAlign: "center" }}>
          <div style={{ fontFamily: "'Archivo',sans-serif", fontWeight: 800, letterSpacing: 1, fontSize: 14, marginBottom: 4 }}>
            LOG BODYWEIGHT
          </div>
          <p style={{ ...S.note, marginBottom: 16 }}>Once a day, first thing in.</p>
          <input
            autoFocus
            type="number"
            inputMode="decimal"
            placeholder="184.0"
            value={val}
            onChange={(e) => { setVal(e.target.value); setErr(""); }}
            style={{ ...S.fInput, width: "100%", textAlign: "center", fontSize: 16, marginBottom: 8 }}
          />
          {err && <div style={{ color: "#ff5d7a", fontSize: 12, marginBottom: 8 }}>{err}</div>}
          <button style={{ ...S.primaryBtn, width: "100%", marginBottom: 8 }} onClick={submit} disabled={saving}>
            {saving ? "saving…" : "save"}
          </button>
          <button
            style={{ ...S.ghostBtn, width: "100%", background: "transparent", border: "none", color: dim }}
            onClick={onSkip}
          >
            skip today
          </button>
        </div>
      </div>
    </div>
  );
}

// Past and current diet phase blocks, newest first. Back-to-back phases of
// the same type are one block (same rule the volume math uses). Each shows
// its calories vs Maintenance and the training volume impact it had
// reached by its last day (or today, for the current one).
function PhaseHistory({ dietPhases, bwLog, presets }) {
  const today = todayISO();
  const sorted = [...(dietPhases || [])]
    .filter((r) => r.start_date <= today)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const blocks = [];
  sorted.forEach((r) => {
    const last = blocks[blocks.length - 1];
    if (last && last.type === r.phase_type) last.rows.push(r);
    else blocks.push({ type: r.phase_type, rows: [r] });
  });
  blocks.forEach((b, i) => {
    const lastRow = b.rows[b.rows.length - 1];
    const nextStart = blocks[i + 1]?.rows[0].start_date;
    let end = nextStart ? addDaysISO(nextStart, -1) : today;
    if (lastRow.end_date && lastRow.end_date < end) end = lastRow.end_date;
    b.start = b.rows[0].start_date;
    b.end = end;
    b.current = !nextStart && (!lastRow.end_date || lastRow.end_date >= today);
    b.weeks = Math.max(1, Math.round((daysBetween(b.start, end) + 1) / 7));
    b.name = b.rows[0].phase_name;
    b.cals = phaseCalories(lastRow, presets, null);
    b.impact = Math.round(volumeImpactPct(dietPhaseContext(dietPhases, end, bwLog)));
  });
  if (!blocks.length) return null;
  const fmt = (iso) => parseISO(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const sign = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n);
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={S.phKicker}>PHASE HISTORY</div>
      {blocks.slice().reverse().map((b) => {
        const color = PHASE_COLORS[b.type] || dim;
        const calPct = b.cals?.pct == null ? null : Math.round(b.cals.pct);
        return (
          <div key={b.start} style={{ ...S.phRow, borderLeft: `3px solid ${color}` }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{b.name}{b.current ? " · now" : ""}</div>
              <div style={{ color: dim, fontSize: 12 }}>
                {fmt(b.start)} – {b.current
                  ? `today (week ${Math.floor(daysBetween(b.start, today) / 7) + 1})`
                  : `${fmt(b.end)} (${b.weeks} wk${b.weeks === 1 ? "" : "s"})`}
              </div>
            </div>
            <div style={{ textAlign: "right", fontSize: 12, flexShrink: 0 }}>
              <div style={{ color: calPct ? color : dim, fontWeight: 600 }}>
                {calPct == null ? "—" : calPct === 0 ? "0% cals" : `${sign(calPct)}% cals`}
              </div>
              <div style={{ color: b.impact ? color : dim }}>
                {b.impact ? `${sign(b.impact)}% volume` : "baseline volume"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Phases({ phases, setPhases, dietPhase, dietPhases, bwLog, onSwitchPhase, onOpenCalendar }) {
  const prog = phaseProgress(dietPhase, todayISO());
  const set = (id, key, sub, val) =>
    setPhases((prev) =>
      prev.map((p) =>
        p.id === id
          ? sub
            ? { ...p, target: { ...p.target, [key]: parseFloat(val) || 0 } }
            : { ...p, [key]: val }
          : p
      )
    );
  return (
    <div>
      <div style={{ ...S.phaseCard, marginBottom: 20 }}>
        <div style={{ fontSize: 11, letterSpacing: 1, color: dim, marginBottom: 6 }}>
          CURRENT PHASE
        </div>
        {dietPhase ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{dietPhase.phase_name}</div>
              <div style={{ fontSize: 12, color: dim }}>
                {dietPhase.phase_type} · since {dietPhase.start_date} · week {prog.week}
                {prog.plannedWeeks ? ` of ${prog.plannedWeeks}` : ""}
                {prog.overrun ? " · past planned end" : ""}
              </div>
            </div>
            <select
              value=""
              onChange={(e) => {
                const preset = phases.find((p) => p.id === e.target.value);
                if (preset) onSwitchPhase(preset);
              }}
              style={S.fInput}
            >
              <option value="" disabled>switch phase…</option>
              {phases
                .filter((p) => p.id !== dietPhase.phase_id)
                .map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
            </select>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: dim }}>no phase set yet</div>
        )}
        <button style={{ ...S.ghostBtn, width: "100%", marginTop: 10 }} onClick={onOpenCalendar}>
          plan phases on the calendar
        </button>
      </div>
      <PhaseHistory dietPhases={dietPhases} bwLog={bwLog} presets={phases} />
      <p style={S.note}>
        These are your macro targets. Each day in Plan uses the targets of the
        diet phase it falls in (a Cut day uses Cut). To give one weekday its own
        targets, such as a Saturday refeed, pick it in that day's TARGETS menu.
      </p>
      {phases.map((p) => (
        <div key={p.id} style={S.phaseCard}>
          <input
            value={p.name}
            onChange={(e) => set(p.id, "name", false, e.target.value)}
            style={S.phaseName}
          />
          <div style={S.macroGrid}>
            {[
              ["Protein", "p"],
              ["Fat", "f"],
              ["Carbs", "c"],
              ["Calories", "cal"],
            ].map(([lab, k]) => (
              <div key={k}>
                <span style={S.macroMini}>{lab}</span>
                <input
                  type="number"
                  value={p.target[k]}
                  onChange={(e) => set(p.id, k, true, e.target.value)}
                  style={S.fInput}
                />
              </div>
            ))}
          </div>
          <button
            style={S.xBtnSm}
            onClick={() =>
              setPhases((prev) => prev.filter((x) => x.id !== p.id))
            }
          >
            ✕ remove
          </button>
        </div>
      ))}
      <button
        style={S.addSlot}
        onClick={() =>
          setPhases((prev) => [...prev, ph("New phase", 180, 50, 250, 2500)])
        }
      >
        + add phase
      </button>
    </div>
  );
}

/* ============================================================
   DATA (export / import / reset)
   ============================================================ */
function Data({ foods, phases, week, setFoods, setPhases, setWeek, debugLog }) {
  const [msg, setMsg] = useState("");
  const [showExport, setShowExport] = useState(false);
  const exportText = JSON.stringify({ foods, phases, week }, null, 2);

  const exportJSON = () => {
    // try native download first
    try {
      const blob = new Blob([exportText], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mealprep-backup.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      // ignore — fallback panel below covers it
    }
    // always show fallback panel too, since artifact sandbox often blocks the download silently
    setShowExport(true);
  };

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      setMsg("Copied to clipboard ✓");
    } catch {
      setMsg("Copy failed — select the text manually and copy");
    }
  };
  const importJSON = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (d.foods) setFoods(d.foods);
        if (d.phases) setPhases(d.phases);
        if (d.week) setWeek(d.week);
        setMsg("Imported ✓");
      } catch {
        setMsg("Import failed — invalid file");
      }
    };
    reader.readAsText(file);
  };
  return (
    <div>
      <p style={S.note}>
        Your data lives in this artifact's storage. Export regularly — it's your
        insurance against losing the library if the artifact is rebuilt.
      </p>
      <div style={S.dataRow}>
        <button style={S.primaryBtn} onClick={exportJSON}>
          ⬇ export backup (.json)
        </button>
        <label style={S.ghostBtn}>
          ⬆ import backup
          <input
            type="file"
            accept="application/json"
            onChange={importJSON}
            style={{ display: "none" }}
          />
        </label>
      </div>
      {msg && <div style={S.verifyBanner}>{msg}</div>}

      {showExport && (
        <div style={{marginTop:12}}>
          <p style={{...S.note, marginBottom:8}}>
            If the download didn't trigger (common in this sandboxed view),
            copy the text below and save it as <code>mealprep-backup.json</code> on your device.
          </p>
          <div style={{display:"flex", gap:8, marginBottom:8}}>
            <button style={S.primaryBtn} onClick={copyExport}>📋 copy to clipboard</button>
            <button style={S.ghostBtn} onClick={()=>setShowExport(false)}>hide</button>
          </div>
          <textarea
            readOnly
            value={exportText}
            onFocus={(e)=>e.target.select()}
            style={{
              width:"100%", height:240, background:"#0a0c0b", border:`1px solid #2a3133`,
              borderRadius:10, color:"#e8efe9", fontFamily:"monospace", fontSize:11,
              padding:10, boxSizing:"border-box", resize:"vertical"
            }}
          />
        </div>
      )}
      <div style={S.statRow}>
        <Stat n={foods.length} label="foods" />
        <Stat n={foods.filter((f) => f.type === "recipe").length} label="recipes" />
        <Stat n={foods.filter((f) => f.verify).length} label="need verify" />
        <Stat n={phases.length} label="phases" />
      </div>

      <div style={{marginTop: 20}}>
        <p style={{...S.note, marginBottom: 8}}>Storage diagnostics — add a food then check here:</p>
        <div style={{background:"#0a0c0b", border:"1px solid #2a3133", borderRadius:10, padding:12, fontFamily:"monospace", fontSize:11, color:"#46e6a0", maxHeight:200, overflowY:"auto"}}>
          {debugLog.length === 0
            ? <span style={{color:"#7d8a85"}}>No events yet — add a food or phase to see log</span>
            : debugLog.map((line, i) => <div key={i}>{line}</div>)
          }
        </div>
      </div>
    </div>
  );
}
function Stat({ n, label }) {
  return (
    <div style={S.stat}>
      <div style={S.statN}>{n}</div>
      <div style={S.statL}>{label}</div>
    </div>
  );
}

/* ============================================================
   STYLES
   ============================================================ */
const ink = "#0c0e0d";
const panel = "#15191a";
const panel2 = "#1c2123";
const line = "#2a3133";
const text = "#e8efe9";
const dim = "#7d8a85";
const accent = "#46e6a0";

const S = {
  app: {
    minHeight: "100vh",
    background: ink,
    color: text,
    fontFamily: "'Spline Sans', system-ui, sans-serif",
    paddingBottom: 60,
  },
  header: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    background: "rgba(12,14,13,0.92)",
    backdropFilter: "blur(10px)",
    borderBottom: `1px solid ${line}`,
    padding: "12px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  brand: { display: "flex", alignItems: "center", gap: 10, width: "100%" },
  brandMark: { color: accent, fontSize: 20, transform: "rotate(0deg)" },
  brandName: {
    fontFamily: "'Archivo', sans-serif",
    fontWeight: 800,
    letterSpacing: 3,
    fontSize: 15,
  },
  brandSub: { color: dim, fontSize: 10, letterSpacing: 1, marginTop: 1 },
  nav: { display: "flex", gap: 6 },
  navBtn: {
    flex: 1,
    padding: "9px 6px",
    background: "transparent",
    border: `1px solid ${line}`,
    color: dim,
    borderRadius: 9,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: 0.5,
    cursor: "pointer",
  },
  navBtnOn: { background: accent, color: ink, borderColor: accent },
  main: { padding: 16, maxWidth: 760, margin: "0 auto" },

  // day tabs — each is a column: the day-select button on top, a small
  // dashed copy-icon button underneath. Both flex:1 within dayTabWrap
  // so the 7-day row still divides evenly on a phone screen.
  dayRow: { display: "flex", gap: 4, marginBottom: 14 },
  dayTabWrap: { flex: 1, display: "flex", flexDirection: "column", gap: 3 },
  dayTab: {
    width: "100%",
    padding: "8px 0",
    background: panel,
    border: `1px solid ${line}`,
    color: dim,
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  dayTabOn: { background: panel2, color: accent, borderColor: accent },

  // date strip + month sheet
  dateHead: { display: "flex", alignItems: "center", gap: 6, marginBottom: 8 },
  dateTitle: {
    background: "transparent", border: "none", color: text, padding: 0,
    fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 20, cursor: "pointer",
  },
  dateNavBtn: {
    background: panel, border: `1px solid ${line}`, color: text, borderRadius: 8,
    padding: "5px 10px", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
  },
  // phase card (top of Plan)
  pcCard: {
    display: "block", width: "100%", boxSizing: "border-box", textAlign: "left",
    background: panel, border: `1px solid ${line}`, borderRadius: 12,
    padding: 14, marginBottom: 14, color: text, fontFamily: "inherit",
  },
  pcEmpty: { color: dim, fontSize: 13, cursor: "pointer" },
  pcTop: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  pcName: { fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 16, letterSpacing: 0.5 },
  pcWeek: { color: dim, fontSize: 12, marginTop: 2 },
  pcLink: {
    background: "transparent", border: "none", color: dim, fontSize: 12,
    cursor: "pointer", fontFamily: "inherit", padding: 0, whiteSpace: "nowrap",
  },
  pcTrack: { height: 6, background: panel2, borderRadius: 3, overflow: "hidden", marginTop: 10 },
  pcFill: { height: "100%", borderRadius: 3 },
  pcStats: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 12 },
  pcStatN: { fontSize: 16, fontWeight: 700 },
  pcStatL: { color: dim, fontSize: 11, marginBottom: 3 },
  pcStatSub: { fontSize: 12, fontWeight: 600, marginTop: 2 },
  phKicker: { color: dim, fontSize: 11, letterSpacing: 1, marginBottom: 8 },
  phRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
    background: panel, borderRadius: 8, padding: "10px 12px", marginBottom: 6,
  },
  pcKicker: { color: dim, fontSize: 10, letterSpacing: 1.2, marginBottom: 3 },
  pcBlurb: { color: dim, fontSize: 12.5, lineHeight: 1.45, marginTop: 8, paddingBottom: 12, borderBottom: `1px solid ${panel2}` },
  viHead: { display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 13, fontWeight: 600, marginTop: 16 },
  viBar: {
    position: "relative", height: 8, borderRadius: 4, marginTop: 10,
    background: `linear-gradient(90deg, ${PHASE_COLORS.deficit}, ${PHASE_COLORS.maintenance} 50%, ${PHASE_COLORS.surplus})`,
  },
  viMarker: {
    position: "absolute", top: -3, width: 14, height: 14, borderRadius: 7,
    background: "#fff", boxShadow: "0 0 0 2px rgba(0,0,0,0.6)",
  },
  viScale: { display: "flex", justifyContent: "space-between", color: dim, fontSize: 10.5, marginTop: 6 },
  viNote: { color: dim, fontSize: 12, lineHeight: 1.45, marginTop: 10 },
  pcNeed: { color: dim, fontSize: 12, lineHeight: 1.45, marginTop: 10 },
  pcNeedCount: { color: text, fontSize: 12, fontWeight: 600, marginTop: 6 },
  pcTarget: { color: text, fontSize: 12, marginTop: 10, opacity: 0.85 },
  pcPace: { fontSize: 12, fontWeight: 700, marginTop: 8 },
  pcProj: { color: dim, fontSize: 12, marginTop: 6 },
  phaseChip: {
    display: "inline-block", border: "1px solid", borderRadius: 999, padding: "3px 10px",
    fontSize: 11, fontWeight: 700, letterSpacing: 0.3, marginBottom: 10,
  },
  monthGrid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 },
  monthCell: {
    aspectRatio: "1 / 1", borderRadius: 10, fontSize: 13, cursor: "pointer",
    fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center",
  },
  dayCopyBtn: {
    width: "100%",
    padding: "3px 0",
    background: "transparent",
    border: `1px dashed ${line}`,
    color: dim,
    borderRadius: 6,
    fontSize: 10,
    lineHeight: 1.4,
    cursor: "pointer",
    fontFamily: "inherit",
  },

  // dashboard
  dash: {
    background: panel,
    border: `1px solid ${line}`,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  dashHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  dashLabel: { fontSize: 10, letterSpacing: 2, color: dim, fontWeight: 700 },
  select: {
    background: panel2,
    color: text,
    border: `1px solid ${line}`,
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 13,
    fontFamily: "inherit",
  },
  bars: { display: "flex", flexDirection: "column", gap: 11 },
  barRow: {},
  barTop: { display: "flex", justifyContent: "space-between", marginBottom: 5 },
  barLabel: { fontSize: 11, color: dim, letterSpacing: 1, fontWeight: 600 },
  barNums: { fontSize: 13, fontFamily: "'Archivo', sans-serif" },
  barGoal: { color: dim, fontWeight: 400 },
  barTrack: {
    height: 6,
    background: "#0a0c0b",
    borderRadius: 4,
    overflow: "hidden",
  },
  barFill: { height: "100%", borderRadius: 4, transition: "width .25s ease" },

  // slot
  slot: {
    background: panel,
    border: `1px solid ${line}`,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  // food-log check-off
  slotLogged: { borderColor: "rgba(70,230,160,0.45)" },
  checkBtn: {
    width: 26, height: 26, flexShrink: 0, borderRadius: "50%",
    border: `2px solid ${dim}`, background: "transparent", color: ink,
    fontSize: 15, fontWeight: 800, lineHeight: 1, padding: 0,
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  },
  checkBtnOn: { background: accent, borderColor: accent },
  loggedNote: { color: accent, fontSize: 11, letterSpacing: 0.3, marginBottom: 6, opacity: 0.85 },
  extrasNote: { color: dim, fontSize: 12, marginBottom: 6 },
  slotHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
    flexWrap: "wrap",
  },
  slotName: {
    background: "transparent",
    border: "none",
    borderBottom: `1px solid ${line}`,
    color: text,
    fontSize: 14,
    fontWeight: 700,
    fontFamily: "'Archivo', sans-serif",
    padding: "2px 0",
    flex: 1,
    minWidth: 80,
  },
  slotMacros: { fontSize: 11, color: accent, fontFamily: "'Archivo', sans-serif" },
  entry: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 0",
    borderTop: `1px solid ${line}`,
  },
  qty: {
    width: 52,
    background: panel2,
    border: `1px solid ${line}`,
    color: text,
    borderRadius: 6,
    padding: "5px 6px",
    fontSize: 13,
    fontFamily: "inherit",
  },
  entryUnit: { fontSize: 11, color: dim, width: 46 },
  entryName: { fontSize: 13, flex: 1, display: "flex", alignItems: "center", gap: 6 },
  entryMacros: { fontSize: 11, color: dim, fontFamily: "'Archivo', sans-serif" },
  verifyDot: { color: "#ffb454", fontSize: 8, marginLeft: 5 },
  recipeTag: {
    fontSize: 9,
    background: "#2a3133",
    color: "#5db4ff",
    padding: "2px 6px",
    borderRadius: 5,
    marginLeft: 6,
    letterSpacing: 0.5,
  },
  addEntry: {
    marginTop: 8,
    background: "transparent",
    border: `1px dashed ${line}`,
    color: dim,
    borderRadius: 8,
    padding: "7px 0",
    width: "100%",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  addSlot: {
    background: "transparent",
    border: `1px dashed ${line}`,
    color: accent,
    borderRadius: 10,
    padding: "11px 0",
    width: "100%",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    marginTop: 4,
  },
  xBtn: {
    background: "transparent",
    border: "none",
    color: dim,
    fontSize: 14,
    cursor: "pointer",
  },
  xBtnSm: {
    background: "transparent",
    border: "none",
    color: dim,
    fontSize: 11,
    cursor: "pointer",
  },
  moveButtons: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    marginRight: 6,
    flexShrink: 0,
  },
  moveBtn: {
    background: "transparent",
    border: "none",
    color: dim,
    fontSize: 9,
    cursor: "pointer",
    padding: "1px 3px",
    lineHeight: 1,
  },
  menuBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 40,
  },
  slotMenu: {
    position: "absolute",
    top: "calc(100% + 4px)",
    right: 0,
    background: panel2,
    border: `1px solid ${line}`,
    borderRadius: 10,
    overflow: "hidden",
    zIndex: 41,
    minWidth: 172,
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
  },
  slotMenuItem: {
    display: "block",
    width: "100%",
    textAlign: "left",
    background: "transparent",
    border: "none",
    color: text,
    fontSize: 12.5,
    padding: "10px 12px",
    cursor: "pointer",
    fontFamily: "inherit",
  },

  // foods
  foodsHead: { display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" },
  search: {
    flex: 1,
    minWidth: 120,
    background: panel2,
    border: `1px solid ${line}`,
    color: text,
    borderRadius: 8,
    padding: "9px 12px",
    fontSize: 14,
    fontFamily: "inherit",
  },
  verifyBanner: {
    background: "rgba(255,180,84,0.1)",
    border: "1px solid rgba(255,180,84,0.3)",
    color: "#ffb454",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 12,
    marginBottom: 14,
  },
  saveBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    background: "rgba(255,93,122,0.12)",
    borderBottom: "1px solid rgba(255,93,122,0.4)",
    color: "#ff5d7a",
    padding: "10px 16px",
    fontSize: 12.5,
    fontWeight: 600,
  },
  saveBannerBtn: {
    background: "transparent",
    border: "1px solid rgba(255,93,122,0.5)",
    color: "#ff5d7a",
    borderRadius: 7,
    padding: "4px 10px",
    fontSize: 11,
    cursor: "pointer",
    fontFamily: "inherit",
    flexShrink: 0,
  },
  foodGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: 10,
  },
  foodCard: {
    background: panel,
    border: `1px solid ${line}`,
    borderRadius: 11,
    padding: 12,
    cursor: "pointer",
  },
  foodCardTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  foodCardName: { fontSize: 13, fontWeight: 600 },
  foodCardMacros: {
    display: "flex",
    gap: 10,
    fontSize: 11,
    color: dim,
    fontFamily: "'Archivo', sans-serif",
    flexWrap: "wrap",
  },
  foodCardUnit: { color: "#4d5854" },

  // modal
  modalWrap: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: 16,
    zIndex: 50,
    overflowY: "auto",
  },
  modal: {
    background: panel,
    border: `1px solid ${line}`,
    borderRadius: 16,
    width: "100%",
    maxWidth: 440,
    marginTop: 40,
    overflow: "hidden",
  },
  modalHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderBottom: `1px solid ${line}`,
  },
  modalList: { maxHeight: "60vh", overflowY: "auto", padding: 8 },
  pickItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    background: "transparent",
    border: "none",
    borderRadius: 8,
    padding: "10px 10px",
    color: text,
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
    textAlign: "left",
  },
  pickUnit: { fontSize: 11, color: dim },
  empty: { color: dim, textAlign: "center", padding: 20, fontSize: 13 },
  headerAddBtn: {
    background: "transparent",
    border: `1px solid ${accent}`,
    color: accent,
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
    flexShrink: 0,
    width: 32,
    height: 32,
    borderRadius: 8,
    lineHeight: 1,
    fontFamily: "inherit",
  },
  quickAddRow: {
    display: "block",
    width: "100%",
    marginTop: 4,
    background: "rgba(70,230,160,0.06)",
    border: `1px dashed ${accent}`,
    color: accent,
    borderRadius: 8,
    padding: "10px 10px",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    textAlign: "left",
  },
  newTag: {
    fontSize: 9,
    background: "rgba(70,230,160,0.15)",
    color: accent,
    padding: "2px 6px",
    borderRadius: 5,
    marginLeft: 6,
    letterSpacing: 0.5,
  },

  // editor
  editorBody: { padding: 16, display: "flex", flexDirection: "column", gap: 4 },
  fLabel: {
    fontSize: 10,
    letterSpacing: 1.5,
    color: dim,
    fontWeight: 700,
    marginTop: 8,
    marginBottom: 4,
    display: "block",
  },
  fInput: {
    width: "100%",
    background: panel2,
    border: `1px solid ${line}`,
    color: text,
    borderRadius: 8,
    padding: "9px 10px",
    fontSize: 14,
    fontFamily: "inherit",
    boxSizing: "border-box",
  },
  fRow: { display: "flex", gap: 10 },
  macroGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 },
  macroMini: { fontSize: 10, color: dim, display: "block", marginBottom: 3 },
  checkRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    fontSize: 12,
    color: dim,
    cursor: "pointer",
  },
  ingRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 0",
  },
  recipeTotal: {
    marginTop: 14,
    padding: 12,
    background: panel2,
    borderRadius: 10,
    border: `1px solid ${line}`,
  },
  editorFoot: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    padding: 12,
    borderTop: `1px solid ${line}`,
  },
  primaryBtn: {
    background: accent,
    color: ink,
    border: "none",
    borderRadius: 8,
    padding: "9px 14px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  ghostBtn: {
    background: "transparent",
    border: `1px solid ${line}`,
    color: text,
    borderRadius: 8,
    padding: "9px 14px",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  dangerBtn: {
    background: "transparent",
    border: "1px solid #5a2a2a",
    color: "#ff5d7a",
    borderRadius: 8,
    padding: "9px 14px",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
  },

  // phases
  note: { color: dim, fontSize: 13, lineHeight: 1.5, marginBottom: 16 },
  phaseCard: {
    background: panel,
    border: `1px solid ${line}`,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  phaseName: {
    background: "transparent",
    border: "none",
    borderBottom: `1px solid ${line}`,
    color: text,
    fontSize: 15,
    fontWeight: 700,
    fontFamily: "'Archivo', sans-serif",
    marginBottom: 12,
    padding: "2px 0",
    width: "100%",
  },

  // data
  dataRow: { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  statRow: { display: "flex", gap: 8 },
  stat: {
    flex: 1,
    background: panel,
    border: `1px solid ${line}`,
    borderRadius: 11,
    padding: "14px 8px",
    textAlign: "center",
  },
  statN: {
    fontSize: 22,
    fontWeight: 800,
    fontFamily: "'Archivo', sans-serif",
    color: accent,
  },
  statL: { fontSize: 10, color: dim, letterSpacing: 1, marginTop: 2 },
};

function Style() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=Spline+Sans:wght@400;500;600&display=swap');
      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      body { margin: 0; }
      input, select, button { outline: none; }
      input:focus, select:focus { border-color: ${accent} !important; }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-thumb { background: ${line}; border-radius: 4px; }
      input[type=number]::-webkit-inner-spin-button { opacity: .4; }
    `}</style>
  );
}
