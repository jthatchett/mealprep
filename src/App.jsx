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
const DAY_NAMES = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

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

// true if the access token has expired or will within `bufferSeconds`
function tokenExpiringSoon(access_token, bufferSeconds = 300) {
  try {
    const b64 = access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(b64 + "===".slice((b64.length + 3) % 4)));
    return !exp || Date.now() / 1000 >= exp - bufferSeconds;
  } catch {
    return true; // can't read it — refreshing is the safe choice
  }
}

/* ---------- 18+ / terms consent ----------
   Stored on the auth user's user_metadata, shared with RepReport (same
   Supabase project, same user), so confirming in either app covers both.
   Mirrors RepReport's src/supabase.js — bump TERMS_VERSION in both apps
   together, and every user is asked again on their next open. */
const TERMS_VERSION = "2026-10-09";
const PRIVACY_URL = "https://repreport.app/privacy.html";
const TERMS_URL = "https://repreport.app/terms.html";

function hasConsent(user) {
  const meta = user?.user_metadata;
  return !!meta?.age_confirmed_at && meta?.terms_version === TERMS_VERSION;
}

// PUT /auth/v1/user merges `data` into user_metadata and returns the updated
// user. Retries once with a refreshed token. Resolves to the new session.
async function sbRecordConsent(session) {
  return sbUpdateUserMeta(session, { age_confirmed_at: new Date().toISOString(), terms_version: TERMS_VERSION }, "couldn't save your confirmation");
}

async function sbUpdateUserMeta(session, fields, failMsg = "couldn't save") {
  const put = (s) => fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${s.access_token}`,
    },
    body: JSON.stringify({ data: fields }),
  });
  let sess = session;
  let res = await put(sess);
  if (res.status === 401 || res.status === 403) {
    const refreshed = await sbRefreshToken(sess.refresh_token);
    sess = { access_token: refreshed.access_token, refresh_token: refreshed.refresh_token, user: refreshed.user || sess.user };
    res = await put(sess);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || failMsg);
  return { ...sess, user: data };
}

// Account export / deletion, shared with RepReport: the `account` Edge
// Function resolves the user from their own token and only acts on them.
// "export" returns everything in both apps; "delete" (confirm: "DELETE")
// removes photos, every row, and the login. Retries once on an expired token.
async function sbAccountAction(session, action, extra = {}) {
  const call = (s) => fetch(`${SUPABASE_URL}/functions/v1/account`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${s.access_token}` },
    body: JSON.stringify({ action, ...extra }),
  });
  let res = await call(session);
  if (res.status === 401) {
    const r = await sbRefreshToken(session.refresh_token);
    res = await call({ access_token: r.access_token });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

// Feedback to the developer: shared feedback table with RepReport
// (insert-only for users via RLS). Retries once on an expired token.
async function sbSendFeedback(session, message) {
  const post = (s) => fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${s.access_token}`, Prefer: "return=minimal" },
    body: JSON.stringify({ app: "Meal Prep", message, screen: "data", app_version: "v0.1", user_agent: navigator.userAgent.slice(0, 300) }),
  });
  let res = await post(session);
  if (res.status === 401) {
    const r = await sbRefreshToken(session.refresh_token);
    res = await post({ access_token: r.access_token });
  }
  if (!res.ok) throw new Error(`couldn't send feedback (${res.status})`);
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
  // maintenance that runs past its planned end is just open-ended maintenance
  // (owner's call, Nov 2026); a cut or bulk is switched to maintenance instead
  const past = !!row.planned_end_date && iso > row.planned_end_date;
  const plannedWeeks = row.planned_end_date && !(past && row.phase_type === "maintenance")
    ? Math.max(1, Math.round((daysBetween(row.start_date, row.planned_end_date) + 1) / 7))
    : null;
  return { week, plannedWeeks, overrun: past && row.phase_type !== "maintenance" };
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
  if (phaseType === "surplus") return 1.0 / WEEKS_PER_MONTH; // bottom of Iraki et al. 2019's ~1–2 %/month
  return 0;
}
// Limits on a phase's target rate (owner-approved, Oct 2026). The warning
// is a note the user can save past; the limit refuses to save.
//   cut       warn past -1.0 %/wk (top of Helms et al. 2014's 0.5–1.0 %/wk
//             range for keeping muscle); limit -1.5 %/wk (~Garthe et al.
//             2011's "fast" 1.4 %/wk group, the fastest rate studied)
//   mini-cut  warn past -1.25 %/wk, limit -1.5 %/wk (coaching practice;
//             no controlled studies)
//   bulk      warn past 2 %/month (top of Iraki et al. 2019's
//             0.25–0.5 %/wk), limit 4 %/month (catches typos)
// Returns { level: "ok" | "warn" | "block", message }.
const EPS = 1e-6;
function checkPhaseRate(phaseType, name, weeklyPct) {
  if (weeklyPct == null || phaseType === "maintenance") return { level: "ok", message: "" };
  if (phaseType === "deficit") {
    const loss = -weeklyPct;
    const mini = isMiniCut(phaseType, name);
    if (loss > 1.5 + EPS) return { level: "block", message: `a ${mini ? "mini-cut" : "cut"} can be at most −1.5 %/week` };
    if (mini && loss > 1.25 + EPS) return { level: "warn", message: "faster than the ~1.25 %/week mini-cuts usually run at. You can still save it." };
    if (!mini && loss > 1.0 + EPS) return { level: "warn", message: "faster than the 0.5–1.0 %/week range research supports for keeping muscle. You can still save it." };
    return { level: "ok", message: "" };
  }
  if (phaseType === "surplus") {
    const monthly = weeklyPct * WEEKS_PER_MONTH;
    if (monthly > 4 + EPS) return { level: "block", message: "a bulk can be at most 4 %/month" };
    if (monthly > 2 + EPS) return { level: "warn", message: "faster than the ~1–2 %/month research suggests for lean gains (Iraki et al. 2019); faster tends to add more fat. You can still save it." };
  }
  return { level: "ok", message: "" };
}
function phaseRatePct(row) {
  return row.target_rate_pct != null ? Number(row.target_rate_pct) : defaultRatePct(row.phase_type, row.phase_name);
}
// bulks are read and entered per month; cuts and maintenance per week
const rateIsMonthly = (phaseType) => phaseType === "surplus";
const roundRate = (n) => Math.round(n * 1e4) / 1e4;

const PHASE_COLORS = { deficit: "#ff8a5c", maintenance: "#7aa7ff", surplus: "#46e6a0" };
const REPREPORT_AMBER = "#fbbf24"; // RepReport's accent, wherever its data shows in Meal Prep

/* ---------- training volume impact (mirrors RepReport) ----------
   How much the diet phase is moving RepReport's recovery ceilings (MRV),
   as a % of baseline. This is a straight port of RepReport's
   resolveDietPhaseContext + dietVolumeImpactPct (src/App.jsx there) — keep
   the two in step. In short: every muscle's MRV moves by one flat share,
   -20% at a cut's full effect and +10% at a bulk's (a surplus helps
   recovery less than a deficit hurts it); the shift builds with how far
   through the phase you are (planned length, else 12 weeks) and scales
   with how fast weight is actually moving (1%/wk loss or 0.5%/wk gain =
   full effect; half until a weight trend exists, and a cut its planned
   pace until it has its own trend, see CUT_WATER_DAYS). Maintenance phases
   don't shift anything. A mini-cut takes ~30% off (see MINICUT_VOLUME_CUT). */
const VOLUME_CUT_SHIFT = 0.2;  // MRV -20% at a cut's full effect
const VOLUME_HOLD_DAYS = 7;    // a phase's level holds at the highest it kept this many days in a row
const VOLUME_BULK_SHIFT = 0.1; // MRV +10% at a bulk's full effect
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

/* Mini-cuts cut volume harder than a regular cut does (-20% at most):
   ~30% off MRV and the volume target, from week 1 rather than
   building across the phase (a 2–6 wk crash phase has no time to build).
   Coaching guidance for mini-cuts puts training at ~⅔–¾ of usual volume;
   30% is the middle of that — a starting point to refine. Full strength
   until the weight trend's 2 weeks of weigh-ins all fall inside the
   mini-cut (the default mini-cut pace, 1%/wk, is the full-effect rate),
   then scaled by that trend like any phase. */
const MINICUT_VOLUME_CUT = 0.3;
// points of the volume bar per unit of a phase's own level, by kind
const VOLUME_SHARE_PCT = { deficit: VOLUME_CUT_SHIFT * 100, surplus: VOLUME_BULK_SHIFT * 100, minicut: MINICUT_VOLUME_CUT * 100 };
/* The weight trend reads the 14 days ending on a date (weightTrend): a
   reading counts for a mini-cut only when its first day is on or after the
   mini-cut's start. Before that it still reads the phase before, often a
   bulk's gain, which held the reduction back for half of a 4-week
   mini-cut. Owner's choice (Oct 2026) over a flat 30% that ignores the
   scale. RepReport's MINICUT_TREND_DAYS; keep the two in step. */
const MINICUT_TREND_DAYS = 14;
/* A cut's first week loses mostly water and glycogen, and until a cut has
   its own trend the 14-day trend still reads the phase before. So a cut's
   trend counts only once its 14 days start after the cut's first
   CUT_WATER_DAYS (from day 20); until then, and whenever the cut has no
   trend of its own, it runs at its planned pace (the covering row's
   target_rate_pct), or VOLUME_DEFAULT_STRENGTH with none planned. Planned
   days count as assumed, so they don't set the hold. Owner's choice, Oct
   2026. RepReport's CUT_WATER_DAYS; keep the two in step. */
const CUT_WATER_DAYS = 7;
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

// The plain-language note under "Training volume impact": where the
// ceilings sit and what that's based on: the weigh-in trend, or an assumed
// pace until 2 weeks of weigh-ins exist. RepReport's dashboard says the
// same (dietImpactNote there); keep the two in step.
// The week of a cut or bulk (week 1 = its first 7 days) from which a scale
// going nowhere gets the stalled wording. Same as RepReport. (c)
const STALLED_CUT_NOTE_WEEKS = 3;
function volumeImpactNote(ctx, impactR, applied) {
  const level = impactR === 0
    ? "Volume ceilings are at your normal baseline"
    : `Volume ceilings are ~${Math.abs(impactR)}% ${impactR < 0 ? "below" : "above"} baseline`;
  if (!ctx?.typed) return impactR === 0 ? `${level}.` : `${level}. ${applied}`;
  const losing = ctx.type === "deficit";
  const verb = losing ? "losing" : "gaining";
  const word = ctx.kind === "minicut" ? "mini-cut" : losing ? "cut" : "bulk";
  const need = `2 weeks of weigh-ins${ctx.kind === "minicut" ? " during the mini-cut" : ""} (${TREND_MIN_WEIGHINS}+ each week)`;
  if (ctx.holding && impactR !== 0) {
    const pace = ctx.rate == null ? null : `${ctx.rate >= 0 ? "+" : "−"}${Math.abs(ctx.rate * 100).toFixed(1)}%/week`;
    const stale = pace && ctx.rateAge > 0;
    const now = !pace ? "" : stale ? ` (your last trend, ${ctx.rateAge} day${ctx.rateAge === 1 ? "" : "s"} ago: ${pace})` : ` (the scale now: ${pace})`;
    const tail = !pace ? ` Your pace shows again after ${need}.` : stale ? " Weigh in to update it." : "";
    return `${level}, held at the most this ${word} has built up${now}: a slower or flat scale doesn't undo it. ${applied}${tail}`;
  }
  if (ctx.planned) {
    const t = ctx.phase?.target_rate_pct;
    const pace = `you're losing ${+Math.abs(Number(t) || 0).toFixed(2)}%/week (your planned pace)`;
    const when = ctx.trendFrom && ctx.date < ctx.trendFrom
      ? `From ${shortDate(ctx.trendFrom)}, your weigh-ins set it (a cut's first week is mostly water)`
      : `After ${need}, your actual trend sets it`;
    return impactR === 0 ? `${level}. ${when}; until then it assumes ${pace}.` : `${level}, assuming ${pace}. ${when}. ${applied}`;
  }
  if (ctx.estimated) {
    const assumed = ctx.kind === "minicut" ? VOLUME_DEFICIT_FULL_RATE : (losing ? VOLUME_DEFICIT_FULL_RATE : VOLUME_SURPLUS_FULL_RATE) * VOLUME_DEFAULT_STRENGTH;
    const pace = `you're ${verb} ${+(assumed * 100).toFixed(2)}%/week${ctx.kind === "minicut" ? " (the usual mini-cut pace)" : ""}`;
    return impactR === 0
      ? `${level}. Until you have ${need}, it assumes ${pace}.`
      : `${level}, assuming ${pace}. After ${need}, your actual trend sets it. ${applied}`;
  }
  const r = ctx.rate * 100;
  const shown = `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}%/week`;
  if (losing ? r >= 0 : r <= 0) {
    // the trend contradicts the phase: anything left is an earlier phase fading
    if (impactR !== 0) return `${level}. ${applied}`;
    // From week 3 of a cut with no loss (or a bulk with no gain) to show,
    // "yet" no longer fits: say it isn't working and where to look (owner's
    // call, Oct 2026).
    // RepReport's dietImpactNote says the same, plus "in Meal Prep".
    const weeks = Math.floor(daysBetween(ctx.blockStart, ctx.date) / 7);
    if (weeks >= STALLED_CUT_NOTE_WEEKS - 1) {
      return `${level}: your weight hasn't ${losing ? "dropped" : "risen"} since this ${word} started ${weeks} weeks ago (now ${shown}), so RepReport plans as if you're at maintenance. If you're eating in a ${losing ? "deficit" : "surplus"}, check your logging.`;
    }
    return `${level}: your weight isn't ${losing ? "dropping" : "rising"} (${shown}), so the ${word} isn't affecting recovery yet.`;
  }
  // a gap in weigh-ins: still your last real trend, with how old it is
  const stale = ctx.rateAge > 0;
  const based = stale
    ? `based on your last trend (${verb} ${Math.abs(r).toFixed(1)}%/week, ${ctx.rateAge} day${ctx.rateAge === 1 ? "" : "s"} ago)`
    : `based on ${verb} ${Math.abs(r).toFixed(1)}%/week`;
  const update = stale ? " Weigh in to update it." : "";
  if (impactR !== 0) return `${level}, ${based}. ${applied}${update}`;
  return ctx.kind === "minicut" ? `${level}, ${based}.${update}` : `${level}, ${based}. The adjustment builds as the ${word} goes on.${update}`;
}

// A block's weeks from its start to `iso` (inclusive)
const blockWeeksTo = (b, iso) => (daysBetween(b.start, iso) + 1) / 7;

// The phase's context on a date: the covering phase and its own effect
// (progress through the block × strength from the weight trend), plus
// whatever an earlier cut or bulk still leaves behind. deficit / surplus
// are the combined levels (0–1) the MRV shift uses.
// The trend to use on a day: that day's if ready, else the most recent one
// from the last VOLUME_TREND_MAX_AGE_DAYS (a missed week of weigh-ins keeps
// your real pace instead of the assumed one); older than that, null.
// RepReport's latestWeeklyWeightRate does the same; keep the two in step.
const VOLUME_TREND_MAX_AGE_DAYS = 21;
// Readings by date for one weigh-in log. dietPhaseContext reads every day of
// every phase (each phase is held at its highest), and the phase history
// calls it once per block, so each reading is worked out once. Safe because
// the log is replaced, never edited in place (setBwLog); the length check
// is a backstop. RepReport's cachedRate does the same.
const trendCache = new WeakMap();
function cachedTrend(bwLog, key, compute) {
  if (!bwLog) return compute();
  let c = trendCache.get(bwLog);
  if (!c || c.n !== bwLog.length) { c = { n: bwLog.length, by: new Map() }; trendCache.set(bwLog, c); }
  if (!c.by.has(key)) c.by.set(key, compute());
  return c.by.get(key);
}
const cachedWeightTrend = (bwLog, day) => cachedTrend(bwLog, `r${day}`, () => weightTrend(bwLog, day));
const latestTrendRate = (bwLog, day) => cachedTrend(bwLog, `l${day}`, () => findLatestTrendRate(bwLog, day));
function findLatestTrendRate(bwLog, day) {
  const now = cachedWeightTrend(bwLog, day);
  if (now.ready) return { rate: now.pctPerWeek / 100, age: 0 };
  // in a gap, read the trend as of your last weigh-in: a week cut short by
  // the gap would understate the pace
  const last = (bwLog || []).filter((r) => r.date <= day).map((r) => r.date).sort().pop();
  if (!last) return { rate: null, age: null };
  for (let age = daysBetween(last, day); age <= VOLUME_TREND_MAX_AGE_DAYS; age++) {
    const trend = cachedWeightTrend(bwLog, addDaysISO(day, -age));
    if (trend.ready) return { rate: trend.pctPerWeek / 100, age };
  }
  return { rate: null, age: null };
}

// The most recent ready reading (up to VOLUME_TREND_MAX_AGE_DAYS old) whose
// 14 days all fall on or after `start`. For a weigh-in gap inside a
// mini-cut: latestTrendRate reads the trend as of your last weigh-in, which
// can reach back before the mini-cut even when a later reading, all
// mini-cut weigh-ins, was ready (and used) the day before. RepReport's
// latestWeeklyWeightRateSince does the same; keep the two in step.
function latestTrendInside(bwLog, day, start) {
  const maxAge = Math.min(VOLUME_TREND_MAX_AGE_DAYS, daysBetween(start, day) - (MINICUT_TREND_DAYS - 1));
  for (let age = 0; age <= maxAge; age++) {
    const trend = cachedWeightTrend(bwLog, addDaysISO(day, -age));
    if (trend.ready) return { rate: trend.pctPerWeek / 100, age };
  }
  return { rate: null, age: null };
}

function dietPhaseContext(rows, iso, bwLog) {
  const phase = phaseOnDate(rows, iso);
  if (!phase) return null;
  // plannedPct: the covering row's planned %/week, for a cut before its own trend (CUT_WATER_DAYS)
  const strengthOn = (type, day, kind, start, plannedPct = null) => {
    let { rate, age } = latestTrendRate(bwLog, day);
    // a mini-cut ignores a trend that reaches back before it (MINICUT_TREND_DAYS), a
    // cut one that reaches into its first week (CUT_WATER_DAYS); each uses its latest
    // reading from after that, else none
    const from = kind === "minicut" ? start : kind === "deficit" ? addDaysISO(start, CUT_WATER_DAYS) : null;
    if (from && rate !== null && addDaysISO(day, -(age + MINICUT_TREND_DAYS - 1)) < from) {
      ({ rate, age } = latestTrendInside(bwLog, day, from));
    }
    if (kind === "minicut") return { s: rate === null ? 1 : rate < 0 ? Math.min(1, -rate / VOLUME_DEFICIT_FULL_RATE) : 0, estimated: rate === null, rate, rateAge: age };
    if (type === "deficit" && rate === null && plannedPct != null && plannedPct < 0) {
      return { s: Math.min(1, -plannedPct / 100 / VOLUME_DEFICIT_FULL_RATE), estimated: true, planned: true, rate, rateAge: age };
    }
    if (type === "deficit") return { s: rate === null ? VOLUME_DEFAULT_STRENGTH : rate < 0 ? Math.min(1, -rate / VOLUME_DEFICIT_FULL_RATE) : 0, estimated: rate === null, rate, rateAge: age };
    if (type === "surplus") return { s: rate === null ? VOLUME_DEFAULT_STRENGTH : rate > 0 ? Math.min(1, rate / VOLUME_SURPLUS_FULL_RATE) : 0, estimated: rate === null, rate, rateAge: age };
    return { s: 0, estimated: rate === null, rate, rateAge: age };
  };
  // the block's own effect on a day inside it
  const own = (b, day) => {
    const covering = [...b.rows].reverse().filter((r) => r.start_date <= day);
    const plannedEnd = (covering.find((r) => r.planned_end_date) || {}).planned_end_date || null;
    const weeksIn = Math.max(0, daysBetween(b.start, day) / 7);
    const plannedWeeks = plannedEnd ? Math.max(1, (daysBetween(b.start, plannedEnd) + 1) / 7) : VOLUME_FULL_EFFECT_WEEKS;
    const progress = b.kind === "minicut" ? 1 : Math.min(1, weeksIn / plannedWeeks);
    const t = covering[0]?.target_rate_pct;
    const { s, estimated, planned = false, rate, rateAge } = strengthOn(b.type, day, b.kind, b.start, t != null && Number.isFinite(Number(t)) ? Number(t) : null);
    return { progress, strength: s, estimated, planned, rate, rateAge, level: progress * s };
  };
  // The block's level on a day, held at the highest it has reached for a
  // full week (VOLUME_HOLD_DAYS in a row): a flat or slower scale pauses the
  // build-up rather than undoing it, inside the phase and for the fade after
  // it, while one lucky weigh-in can't set the high (owner's choice, Oct
  // 2026). Only days the weight trend actually showed count toward that
  // high; an assumed pace counts on its own day only, so a mini-cut's
  // assumed 30% doesn't lock in. Today's level always counts. RepReport's
  // heldLevel; keep the two in step.
  // key "level" (what the ceilings use) or "strength" (the pace alone,
  // held the same way; RepReport's fast-cut rules read it).
  const heldOf = (b, day, key) => {
    let peak = own(b, day)[key];
    const week = []; // the last VOLUME_HOLD_DAYS values, null for an assumed pace
    for (let d = b.start; d < day; d = addDaysISO(d, 1)) {
      const o = own(b, d);
      week.push(o.rate !== null ? o[key] : null);
      if (week.length > VOLUME_HOLD_DAYS) week.shift();
      if (week.length === VOLUME_HOLD_DAYS && week.every((x) => x !== null)) peak = Math.max(peak, Math.min(...week));
    }
    return peak;
  };
  const heldLevel = (b, day) => heldOf(b, day, "level");
  const KINDS = ["deficit", "surplus", "minicut"];
  const carry = { deficit: null, surplus: null, minicut: null }; // { v, end, fadeDays, weeks, name, chainStart }
  const residual = (c, day) => (c ? c.v * Math.max(0, 1 - daysBetween(c.end, day) / c.fadeDays) : 0);
  const blocks = phaseBlocks(rows);
  // days strictly between two dates that fall in a mini-cut
  const miniCutDaysBetween = (from, to) => blocks.reduce((n, x) => {
    if (x.kind !== "minicut") return n;
    const lo = x.start > from ? x.start : addDaysISO(from, 1);
    const end = x.end ?? iso;
    const hi = end < to ? end : addDaysISO(to, -1);
    return n + Math.max(0, daysBetween(lo, hi) + 1);
  }, 0);
  // Days from the end of the last block of b's kind to b's start, as the
  // chain counts them. A bulk's clock stops during a mini-cut: a mini-cut
  // sits inside a bulk to extend it, so the bulk after it (however long the
  // mini-cut ran) is the same bulk (owner's call, Oct 2026). RepReport's
  // chainGap does the same.
  const chainGap = (c, b) => daysBetween(c.end, b.start) - (b.kind === "surplus" ? miniCutDaysBetween(c.end, b.start) : 0);
  // a block of the same type as one still fading picks up where that one
  // stood when it started (held, not decaying) until its own effect passes it
  const held = (b, level) => {
    const c = carry[b.kind];
    const start = c ? c.v * Math.max(0, 1 - chainGap(c, b) / c.fadeDays) : 0;
    return Math.min(1, Math.max(start, level));
  };
  // A block of the same type that starts inside the last one's fade window
  // continues it: chainStart is where that run of blocks began (a cut after
  // a short diet break is the same cut; RepReport's strength check compares
  // against the first one). Time only, not what's left of the effect: a cut
  // that stalled on the scale at the end is still the same cut.
  const inChain = (b) => !!carry[b.kind] && chainGap(carry[b.kind], b) < carry[b.kind].fadeDays;
  const chainStartOf = (b) => (inChain(b) ? carry[b.kind].chainStart : b.start);
  for (const b of blocks) {
    if (b.start > iso) break;
    const typed = KINDS.includes(b.kind);
    if (b.end === null || b.end >= iso) {
      const o = typed ? own(b, iso) : { progress: 0, strength: 0, estimated: false, rate: null, level: 0 };
      const peak = typed ? heldLevel(b, iso) : 0;
      const levels = Object.fromEntries(KINDS.map((k) => [k, residual(carry[k], iso)]));
      if (typed) levels[b.kind] = held(b, peak);
      // A mini-cut's deficit is what calls for its 30%: a bulk still fading
      // doesn't offset it (mini-cuts sit inside a bulk to extend it; owner's
      // call, Oct 2026). RepReport does the same.
      if (b.kind === "minicut") levels.surplus = 0;
      // the earlier phase still fading (the larger, if both are)
      let fading = null;
      for (const t of KINDS) {
        const c = carry[t], r = levels[t] === 0 ? 0 : residual(c, iso);
        if (t !== b.kind && r > 0.005 && (!fading || r > fading.level)) {
          fading = { type: t, name: c.name, level: r, weeksLeft: Math.ceil((c.fadeDays - daysBetween(c.end, iso)) / 7) };
        }
      }
      return { phase, type: b.type, kind: b.kind, blockStart: b.start, chainStart: typed ? chainStartOf(b) : b.start, progress: o.progress, strength: o.strength, estimated: o.estimated, rate: o.rate, rateAge: o.rateAge ?? null, typed,
        // a cut at its planned pace (before its own trend): from when its trend can count
        planned: !!o.planned, trendFrom: o.planned ? addDaysISO(b.start, CUT_WATER_DAYS + MINICUT_TREND_DAYS - 1) : null, date: iso,
        // the pace, held like the level; rounded to 2 decimals as RepReport
        // stamps it, so both apps' fast-cut lines agree at the 0.7 boundary
        heldStrength: typed ? Math.round(heldOf(b, iso, "strength") * 100) / 100 : 0,
        // held above what today's scale alone gives, by at least a point of the bar
        holding: typed && (peak - o.level) * VOLUME_SHARE_PCT[b.kind] >= 1,
        // this block's weeks so far plus the earlier blocks it continues
        chainWeeks: typed ? blockWeeksTo(b, iso) + (inChain(b) ? carry[b.kind].weeks : 0) : null,
        ...levels, fading };
    }
    if (!typed) continue;
    const prev = carry[b.kind];
    const level = held(b, heldLevel(b, b.end));
    const weeks = blockWeeksTo(b, b.end) + (inChain(b) ? prev.weeks : 0);
    const fadeWeeks = b.kind === "surplus" ? bulkMaintenanceWeeks(weeks) : weeks * CUT_MAINTENANCE_FRACTION;
    carry[b.kind] = { v: level, end: b.end, fadeDays: Math.max(7, fadeWeeks * 7), weeks, name: b.name, chainStart: chainStartOf(b) };
  }
  return null;
}

// The change to every muscle's MRV, in % (negative = less volume).
function volumeImpactPct(ctx) {
  if (!ctx || (!ctx.deficit && !ctx.surplus && !ctx.minicut)) return 0;
  // a cut still fading under a mini-cut doesn't stack on it: the larger
  // of the two reductions applies
  return (-Math.max(VOLUME_CUT_SHIFT * ctx.deficit, MINICUT_VOLUME_CUT * ctx.minicut) + VOLUME_BULK_SHIFT * ctx.surplus) * 100;
}

// The block that ended the day before `iso` (a cut/bulk the phase starting
// that day would follow), ignoring rows in `exclude` — with its length and
// the maintenance RP suggests after it.
function precedingBlock(rows, iso, exclude = []) {
  const kept = (rows || []).filter((r) => !exclude.includes(r.id) && r.start_date < iso);
  const prevDay = addDaysISO(iso, -1);
  const b = phaseBlocks(kept).find((x) => x.start <= prevDay && (x.end === null || x.end >= prevDay));
  if (!b) return null;
  // the whole run when this block continues an earlier one (a cut after a
  // diet break, a bulk after a mini-cut): the length the training fade uses
  const own = blockWeeksTo(b, prevDay);
  const run = dietPhaseContext(kept, prevDay, null)?.chainWeeks ?? own;
  const weeks = Math.max(1, Math.round(run));
  return { type: b.type, name: b.name, weeks, chained: run - own > 0.5, maintenanceWeeks: suggestedMaintenanceWeeks(b.type, b.name, weeks) };
}

const blockLabel = (b) => {
  const kind = isMiniCut(b.type, b.name) ? "mini-cut" : b.type === "deficit" ? "cut" : "bulk";
  return `${b.weeks}-wk ${kind}${b.chained ? ` (counting the earlier ${kind} it continues)` : ""}`;
};

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
  const pct = maint?.target.cal && !maint.example ? ((avg - maint.target.cal) / maint.target.cal) * 100 : null;
  return { avg, pct, baseOnly: followed.target.cal, isMaintenance: followed === maint };
}

/* ---------- target history ----------
   Each macro-target preset's values by the date they took effect
   (target_history table), so a past day is measured against the target it
   had THEN. A row dated BASELINE_DATE is the value when tracking began. */
const BASELINE_DATE = "1970-01-01";
const sameTarget = (a, b) => !!a && !!b && ["p", "f", "c", "cal"].every((k) => Number(a[k]) === Number(b[k]));

// presets with each target as it was on `date` (today and later: as now)
function presetsAsOf(presets, history, date) {
  if (!history?.length || !date || date >= todayISO()) return presets;
  return presets.map((p) => {
    let best = null;
    for (const h of history) {
      if (h.preset_id === p.id && h.effective_date <= date && (!best || h.effective_date > best.effective_date)) best = h;
    }
    return best ? { ...p, target: { p: Number(best.p), f: Number(best.f), c: Number(best.c), cal: Number(best.cal) } } : p;
  });
}

async function sbLoadTargetHistory(session) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/target_history?select=preset_id,effective_date,p,f,c,cal&user_id=eq.${session.user.id}&order=effective_date.asc`,
    { headers: sbHeaders(session) }
  );
  if (!res.ok) throw new Error("Failed to load target history: " + res.status);
  return res.json();
}

// one row per preset per day — a second change the same day replaces the first
async function sbUpsertTargetHistory(session, rows) {
  if (!rows.length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/target_history?on_conflict=user_id,preset_id,effective_date`, {
    method: "POST",
    headers: sbHeaders(session, { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(rows.map((r) => ({ ...r, user_id: session.user.id }))),
  });
  if (!res.ok) throw new Error("Failed to record target change: " + res.status);
}

const historyRow = (preset, effective_date) => ({
  preset_id: preset.id, effective_date,
  p: Number(preset.target.p) || 0, f: Number(preset.target.f) || 0, c: Number(preset.target.c) || 0, cal: Number(preset.target.cal) || 0,
});

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
      target_rate_pct: target_rate_pct ?? roundRate(presetRatePct(preset)),
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
  const next = (rows || [])
    .filter((r) => r.id !== row.id && r.start_date > row.start_date)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0];
  if (next && next.start_date <= start) return;
  // A mini-cut gets no planned maintenance (it goes back into the bulk), but
  // with nothing planned after it, it mustn't stay a deficit: maintenance
  // until the next phase is chosen (owner's call, Nov 2026).
  let planned = len ? addDaysISO(start, len * 7 - 1) : null;
  if (next && (!planned || planned >= next.start_date)) planned = addDaysISO(next.start_date, -1);
  if (!len && next) return; // the bulk (or another phase) is already planned after the mini-cut
  await sbInsertDietPhase(session, { preset: maint, start_date: start, planned_end_date: planned });
}

// A cut, mini-cut or bulk past its planned end with nothing after it (its
// maintenance deleted, say) switches to maintenance: ended yesterday, open-ended
// maintenance from today. Checked when the app opens. Returns true if it changed
// anything. (Owner's call, Nov 2026)
async function sbEndOverrunningPhase(session, rows, presets) {
  const today = todayISO();
  const cur = phaseOnDate(rows, today);
  if (!cur || cur.phase_type === "maintenance" || !cur.planned_end_date || cur.planned_end_date >= today) return false;
  const maint = maintenancePreset(presets);
  if (!maint) return false;
  const start = addDaysISO(cur.planned_end_date, 1) > today ? addDaysISO(cur.planned_end_date, 1) : today;
  await sbUpdateDietPhase(session, cur.id, { end_date: addDaysISO(start, -1) });
  await sbInsertDietPhase(session, { preset: maint, start_date: start, planned_end_date: null });
  return true;
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
      ...fields, target_rate_pct: roundRate(presetRatePct(preset)),
    });
  } else {
    if (current) await sbUpdateDietPhase(session, current.id, { end_date: addDaysISO(today, -1) });
    await sbInsertDietPhase(session, { preset, start_date: today, planned_end_date: planned });
  }
  await sbAddMaintenanceAfter(session, rows.filter((r) => r !== current || current.start_date !== today), { id: null, ...fields }, presets);
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
   Same rule RepReport uses (computeWeeklyWeightRate): ready only when the
   7 days ending today and the 7 days before each have at least 4
   weigh-ins (single weigh-ins swing 1–2% on water alone). The rate is
   the slope of a straight line fitted through every weigh-in in those 2
   weeks, each on its own date: comparing the two weeks' averages
   understates it when weigh-ins bunch up (Mon–Thu one week, Fri–Sun the
   next puts the averages ~4 days apart, not 7). Keep the two in step. */
const TREND_MIN_WEIGHINS = 4;
// least-squares slope (lb per day) and mean weight of the weigh-ins in [from, to]
function weighInFit(log, from, to) {
  const pts = (log || [])
    .filter((r) => r.date >= from && r.date <= to && Number(r.weight) > 0)
    .map((r) => [daysBetween(from, r.date), Number(r.weight)]);
  const n = pts.length;
  const mx = pts.reduce((a, [x]) => a + x, 0) / n, my = pts.reduce((a, [, y]) => a + y, 0) / n;
  const sxx = pts.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  const sxy = pts.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0);
  return { slope: sxx ? sxy / sxx : 0, mean: my };
}
function weightTrend(log, today) {
  const week = (from, to) =>
    (log || []).filter((r) => r.date >= from && r.date <= to).map((r) => Number(r.weight)).filter((w) => w > 0);
  const recent = week(addDaysISO(today, -6), today);
  const prior = week(addDaysISO(today, -13), addDaysISO(today, -7));
  const avg = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  if (recent.length < TREND_MIN_WEIGHINS || prior.length < TREND_MIN_WEIGHINS) {
    return { ready: false, recentCount: recent.length, priorCount: prior.length };
  }
  const fit = weighInFit(log, addDaysISO(today, -13), today);
  const perWeek = fit.slope * 7;
  return { ready: true, avg: avg(recent), perWeek, pctPerWeek: (perWeek / fit.mean) * 100 };
}

// Four-week version for bulks: ready when the last 7 days and days 22–28
// ago each have 4+ weigh-ins; the rate is the fitted slope over all 4
// weeks, scaled to a month.
function monthlyWeightTrend(log, today) {
  const week = (from, to) =>
    (log || []).filter((r) => r.date >= from && r.date <= to).map((r) => Number(r.weight)).filter((w) => w > 0);
  const recent = week(addDaysISO(today, -6), today);
  const old = week(addDaysISO(today, -27), addDaysISO(today, -21));
  const avg = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  if (recent.length < TREND_MIN_WEIGHINS || old.length < TREND_MIN_WEIGHINS) {
    return { ready: false, recentCount: recent.length, oldCount: old.length };
  }
  const fit = weighInFit(log, addDaysISO(today, -27), today);
  const perMonth = fit.slope * 30.44;
  return { ready: true, avg: avg(recent), perMonth, pctPerMonth: (perMonth / fit.mean) * 100 };
}

// Where your weight stands in a phase: your weight when it started, now, and
// (cuts and bulks) where its goal pace puts you today and at its planned end.
// Each weight is the average of a week of weigh-ins (one morning swings
// 1–2 lb on water): "start" the 7 days up to the start (else the first week
// after it), "now" the last 7 days (else the latest weigh-in). The 2-week
// pace can't see a slow drift (−0.2%/week reads "Holding steady" at
// maintenance for months); the change since the start can.
function phaseWeights(row, log, today, anchorDate = row?.start_date) {
  if (!row) return null;
  const pts = (log || []).filter((r) => Number(r.weight) > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  const avgIn = (from, to) => { const w = pts.filter((r) => r.date >= from && r.date <= to).map((r) => Number(r.weight)); return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null; };
  const start = avgIn(addDaysISO(anchorDate, -6), anchorDate) ?? avgIn(anchorDate, addDaysISO(anchorDate, 6));
  const before = pts.filter((r) => r.date <= today);
  const now = avgIn(addDaysISO(today, -6), today) ?? (before.length ? Number(before[before.length - 1].weight) : null);
  if (start == null || now == null) return { start, now, change: null };
  // the plan line runs from the anchor (the phase's start, or where it was re-planned)
  const weeks = Math.max(0, daysBetween(anchorDate, today) / 7);
  const rate = row.phase_type === "maintenance" ? 0 : phaseRatePct(row);
  const at = (w) => start * Math.pow(1 + rate / 100, w);
  const endWeeks = row.planned_end_date ? (daysBetween(anchorDate, row.planned_end_date) + 1) / 7 : null;
  return {
    start, now, change: now - start, weeks,
    planNow: rate ? at(weeks) : null,                       // where the goal pace puts you today
    goalEnd: rate && endWeeks ? at(endWeeks) : null,        // and at the planned end
  };
}

/* ---------- behind plan on a cut or bulk ----------
   The 2-week pace can read "On pace" while the cut as a whole is behind
   (slow early weeks). Past a week of the goal pace behind, the card says so,
   and offers three ways to get back on plan, each redrawing the plan line
   from today (planFrom on the preset): finish later, the same date with a
   lighter goal, or the same date and goal at a faster pace, which gets the
   usual rate checks (a warning past them, not offered past the limit).
   Calories never drop on their own to catch up. (Owner's choice, Nov 2026) */
const planAnchorDate = (row, preset) =>
  (preset?.planFrom && preset.planFrom.rowId === row?.id ? preset.planFrom.date : row?.start_date);
function planStatus(row, preset, log, today) {
  if (!row || (row.phase_type !== "deficit" && row.phase_type !== "surplus")) return null;
  const anchorDate = planAnchorDate(row, preset);
  const wts = phaseWeights(row, log, today, anchorDate);
  if (!wts || wts.planNow == null) return { anchorDate, wts, behindLb: 0, behind: false };
  const rate = phaseRatePct(row);
  // behind: heavier than the plan on a cut, lighter on a bulk
  const behindLb = (wts.now - wts.planNow) * (rate < 0 ? 1 : -1);
  const weekOfPace = Math.abs((rate / 100) * wts.start);
  return { anchorDate, wts, behindLb, behind: behindLb > weekOfPace + 1e-9 };
}
// The three ways back on plan, from today's weight. Each is null when it
// doesn't apply (no planned end, or a phase planned too soon after it).
function behindOptions({ row, wts, today, nextStart = null, name }) {
  const r = phaseRatePct(row) / 100, W = wts.now, G = wts.goalEnd, E = row.planned_end_date;
  if (!E || G == null) return { restart: true };
  const weeksLeft = (daysBetween(today, E) + 1) / 7;
  const n = Math.log(G / W) / Math.log(1 + r);
  let later = null;
  if (n > weeksLeft) {
    const end = addDaysISO(today, Math.round(n * 7) - 1);
    later = { end, goal: G, blockedBy: nextStart && end >= nextStart ? nextStart : null };
  }
  const lighter = { goal: W * Math.pow(1 + r, weeksLeft), end: E };
  const fasterPct = roundRate((Math.pow(G / W, 1 / weeksLeft) - 1) * 100);
  const check = checkPhaseRate(row.phase_type, name ?? row.phase_name, fasterPct);
  const faster = check.level === "block" ? null : { ratePct: fasterPct, goal: G, end: E, warning: check.level === "warn" ? check.message : null };
  return { later, lighter, faster };
}

/* ---------- maintenance holds the weight you started it at ----------
   Maintenance aims to keep you at the weight you began it at, not just to
   stop your weight moving: a drift while the estimate was still learning
   (or while targets were kept) is won back. (Owner's choice, Nov 2026)
   - The weight to hold: a week's average up to the maintenance's start, or,
     after a cut or bulk, up to the day before its pace starts counting
     (paceStartsOn, day 20), once the water from the change has settled.
   - More than HOLD_TRIGGER_PCT away from it: each check-in aims to close a
     quarter of what's left that week (HOLD_WEEKS), as a pace (%/week) on top
     of the estimate, so it never speeds up. 1.8 lb low at 180 lb -> +0.25%/
     week -> about +225 kcal/day, shrinking as you get back; capped at
     HOLD_MAX_RATE_PCT.
   - It stops once within HOLD_DONE_PCT (about 0.45 lb at 180), or after
     HOLD_MAX_WEEKS check-ins, and the check-ins hold from there.
   A running correction is the latest applied check-ins (since the anchor)
   recorded with a non-zero target_rate_pct; a Keep doesn't count. Cuts and
   bulks are unaffected. */
const HOLD_TRIGGER_PCT = 1;
const HOLD_DONE_PCT = 0.25;
const HOLD_WEEKS = 4;
const HOLD_MAX_WEEKS = 16; // a safety stop: at the capped pace, 4 lb takes ~11 weeks
// ...and never faster than the default bulk pace, +1%/month (~0.23%/week),
// either way: a catch-up shouldn't coach past the app's own lean-gain pace
// (owner's choice, Nov 2026). 3.5 lb under at 176.5 lb -> ~0.4 lb/week.
const HOLD_MAX_RATE_PCT = 1 / WEEKS_PER_MONTH;
function maintenanceAnchorDate(rows, row) {
  const from = paceStartsOn(rows, row, false);
  return from ? addDaysISO(from, -1) : row.start_date;
}
// holdFrom: { rowId, date } on the Maintenance preset, set by "Hold my
// current weight instead": that maintenance holds the week up to `date`.
function maintenanceHold(row, rows, log, today, checkins, holdFrom = null) {
  if (!row || row.phase_type !== "maintenance") return null;
  const anchorDate = holdFrom && holdFrom.rowId === row.id ? holdFrom.date : maintenanceAnchorDate(rows, row);
  if (today <= anchorDate) return { anchorDate, waiting: true, ratePct: 0 };
  const w = phaseWeights(row, log, today, anchorDate);
  if (!w || w.change == null) return { anchorDate, ratePct: 0 };
  const gapPct = (w.change / w.start) * 100;
  const weekStart = mondayOf(today);
  const ran = [];
  for (const c of [...(checkins || [])].filter((c) => c.week_start < weekStart && c.week_start >= anchorDate).sort((a, b) => (a.week_start < b.week_start ? 1 : -1))) {
    if (!Number(c.target_rate_pct)) break;
    if (c.action !== "keep") ran.push(c);
  }
  const base = { anchorDate, anchor: w.start, now: w.now, gapLb: w.change, gapPct, weeksRun: ran.length };
  if (!ran.length && Math.abs(gapPct) <= HOLD_TRIGGER_PCT) return { ...base, ratePct: 0 };
  if (ran.length && (Math.abs(gapPct) <= HOLD_DONE_PCT || ran.length >= HOLD_MAX_WEEKS)) return { ...base, ratePct: 0, done: true };
  return { ...base, ratePct: roundRate(-Math.sign(gapPct) * Math.min(Math.abs(gapPct) / HOLD_WEEKS, HOLD_MAX_RATE_PCT)) };
}

/* ---------- "Something off?" on a maintenance check-in done for you ----------
   Undoing it outright let maintenance drift, so each reason does its own fix
   (owner's choice, Nov 2026):
     log         my log was incomplete -> the check-in is withdrawn and the
                 week's days open to fix; it runs again from them
     temporary   my weight is temporarily off -> this week stays as it was;
                 next week's check-in updates it again
     slow        I want to lose or gain slowly -> a slow cut (−0.25%/week)
                 or bulk (+0.5%/month) starts today at its usual length
     hold-reset  hold my current weight instead (only while winning back a
                 drift) -> the weight to hold becomes now; plain maintenance
     cant-eat    I can't eat that right now (only for a change of 150 kcal or
                 6% of calories, whichever is less) -> halfway, or stay this
                 week, with what it costs; one week, then the full number again */
const SLOW_CUT_PCT = -0.25;                        // %/week
const SLOW_BULK_PCT = 0.5 / WEEKS_PER_MONTH;       // +0.5%/month
const CANT_EAT_MIN_KCAL = 150;
const CANT_EAT_MIN_SHARE = 0.06;
const cantEatMinKcal = (cal) => Math.min(CANT_EAT_MIN_KCAL, CANT_EAT_MIN_SHARE * (Number(cal) || 0));
// which reasons this week's check-in offers
function checkinReasons(ck, hold) {
  if (!ck?.chosen?.auto || !ck.before) return [];
  const change = Math.abs(Number(ck.chosen.cal) - Number(ck.before.cal));
  return ["log", "temporary", "slow", ...(hold?.ratePct ? ["hold-reset"] : []), ...(change >= cantEatMinKcal(ck.before.cal) && change > 0 ? ["cant-eat"] : [])];
}
// What a reason changes: the check-in row (patch, or remove), the
// Maintenance target, its holdFrom, and a phase to start. `half`: meet halfway.
function resolveCheckinReason(reason, { ck, row, weightLb, today, half = false }) {
  const before = { p: ck.before.p, f: ck.before.f, c: ck.before.c, cal: ck.before.cal };
  const keep = (r) => ({ patch: { action: "keep", chosen: { auto: true, reason: r } }, target: before });
  if (reason === "log") return { remove: true, target: before, reviewDays: true };
  if (reason === "temporary") return keep("temporary");
  if (reason === "slow-cut" || reason === "slow-bulk") return { ...keep(reason), start: reason === "slow-cut" ? { type: "deficit", ratePct: SLOW_CUT_PCT } : { type: "surplus", ratePct: roundRate(SLOW_BULK_PCT) } };
  if (reason === "hold-reset") {
    const s = suggestTargets({ estimate: Number(ck.estimate), ratePctPerWeek: 0, weightLb, current: before, phaseType: "maintenance", maxChange: checkinMaxChange("maintenance") });
    const target = { p: s.p, f: s.f, c: s.c, cal: s.cal };
    return { patch: { target_rate_pct: 0, chosen: { ...target, auto: true, reason } }, target, holdFrom: { rowId: row.id, date: today } };
  }
  if (reason === "cant-eat") {
    if (!half) return keep("cant-eat");
    const cal = Math.round((Number(ck.before.cal) + Number(ck.chosen.cal)) / 2);
    const t = fitMacros(ck.chosen, cal, { clampCarbs: true });
    const target = { p: t.p, f: t.f, c: t.c, cal };
    return { patch: { chosen: { ...target, auto: true, reason: "cant-eat-half" } }, target };
  }
  return null;
}
// The week a catch-up starts it's explained once, with the choice to hold
// where they are instead (owner's design, Nov 2026).
function catchUpCopy(hold, cal = null) {
  const under = hold.gapLb < 0, lb = Math.abs(hold.gapLb).toFixed(1);
  const kcal = Math.round(Math.abs(paceKcal(hold.ratePct, hold.now)) / 10) * 10;
  const lbWeek = Math.abs((hold.ratePct / 100) * hold.now).toFixed(1);
  return {
    title: `You're ${lb} lb ${under ? "under" : "over"} your maintenance weight`,
    context: `You started maintenance at ${hold.anchor.toFixed(1)} lb${hold.anchorDate ? ` on ${shortDate(hold.anchorDate)}` : ""}. You're at ${hold.now.toFixed(1)} now.`,
    body: `To get back: about ${cal != null ? `${(Math.round(cal / 10) * 10).toLocaleString("en-US")} calories a day (${kcal} ${under ? "over" : "under"} maintenance` : `${kcal} calories a day ${under ? "over" : "under"} maintenance (`}, ≈${lbWeek} lb a week).`,
  };
}
const catchUpStarting = (hold) => !!hold?.ratePct && hold.weeksRun === 0;

// lb a week the scale moves eating `cal` against a maintenance estimate
const driftLbPerWeek = (cal, estimate) => ((cal - estimate) * 7) / KCAL_PER_LB;

/* ---------- maintenance estimate + weekly check-in ----------
   MacroFactor-style: estimate maintenance from logged intake and the
   weight trend, then suggest calories that hit the phase's target rate.
   All pure functions; the app supplies the data. */
const KCAL_PER_LB = 3500;             // standard approximation for a pound of body-weight change
const EST_WINDOW_DAYS = 21;           // data window behind each estimate
const EST_MIN_INCLUDED = 10;          // complete days needed in the window
const EST_MIN_WEIGHINS = 8;           // weigh-in days needed in the window
const EST_STEP = 0.3;                 // each check-in moves 30% toward the new data…
const EST_MAX_STEP = 150;             // …and never more than ±150 kcal
// When two check-ins in a row point the same way (each week's data on the
// same side of the estimate), the move speeds up: 50%, at most ±250 kcal.
// A one-off spike still only gets the normal step. (Owner's choice, Oct 2026)
const EST_STEP_AGREE = 0.5;
const EST_MAX_STEP_AGREE = 250;
const CHECKIN_MAX_CHANGE = 250;       // a check-in moves daily calories at most ±250
// The first check-in with enough data, when the estimate so far is only a
// starting guess (calculator or typed in, ~±10%): your own data replaces the
// guess outright, so the guess can't hold you back for weeks (owner's call,
// Nov 2026, over a 60% step). Later check-ins use the steps above.
const EST_FIRST_STEP = 1;
const EST_FIRST_MAX_STEP = Infinity;
const FIRST_CHECKIN_MAX_CHANGE = 300; // that week's calories still move at most ±300
// How far a check-in may move calories. At maintenance there's no weekly step
// (owner's choice, Nov 2026): the estimate from your data is already trusted
// in full, and stepping toward it held people under (or over) maintenance for
// extra weeks, still drifting, while being told they were "getting back". A
// noisy estimate (~±150 kcal from a water swing) then goes in as is; the
// estimate's own 30% steps take it out over a few weeks (~1 lb at most).
// Cuts and bulks keep the step: they're asked Use / Edit / Keep.
const checkinMaxChange = (phaseType, firstData) =>
  phaseType === "maintenance" ? Infinity : firstData ? FIRST_CHECKIN_MAX_CHANGE : CHECKIN_MAX_CHANGE;
const TREND_ALPHA = 0.1;              // smoothing for the trend-weight line
const lbToKg = (lb) => lb / 2.2046;

// A weight for every day from the first weigh-in to `to`: days between
// weigh-ins are filled in linearly; past the last weigh-in it's held.
function dailyWeights(log, to) {
  const pts = (log || []).map((r) => ({ d: r.date, w: Number(r.weight) })).filter((p) => p.w > 0 && p.d <= to)
    .sort((a, b) => (a.d < b.d ? -1 : 1));
  const out = {};
  if (!pts.length) return out;
  let i = 0;
  for (let d = pts[0].d; d <= to; d = addDaysISO(d, 1)) {
    while (i + 1 < pts.length && pts[i + 1].d <= d) i++;
    const a = pts[i], b = pts[i + 1];
    out[d] = b ? a.w + (b.w - a.w) * (daysBetween(a.d, d) / daysBetween(a.d, b.d)) : a.w;
  }
  return out;
}

// Smoothed trend weight (shown to the user): an exponential moving average
// (10% per day) over the daily weights, which takes out water-weight noise.
function trendSeries(log, to) {
  const daily = dailyWeights(log, to);
  const out = {};
  let trend = null;
  for (const [d, w] of Object.entries(daily)) {
    trend = trend == null ? w : trend + TREND_ALPHA * (w - trend);
    out[d] = trend;
  }
  return out;
}

// Rate of weight change (lb/day) over a window: a least-squares straight
// line through the daily weights. Robust to day-to-day noise, and unlike the
// smoothed trend it doesn't lag behind a steady loss or gain.
function slopePerDay(daily, start, end) {
  const xs = [], ys = [];
  for (let d = start, k = 0; d <= end; d = addDaysISO(d, 1), k++) if (daily[d] != null) { xs.push(k); ys.push(daily[d]); }
  if (xs.length < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  return den ? num / den : null;
}

// Which days count: an explicit choice wins; otherwise a day counts if
// anything was logged. intakeByDate: { iso: kcal }, statusByDate: { iso: bool }
function dayIncluded(iso, intakeByDate, statusByDate) {
  if (statusByDate && iso in statusByDate) return statusByDate[iso] && (intakeByDate[iso] || 0) > 0;
  return (intakeByDate[iso] || 0) > 0;
}

// Unsmoothed estimate from the last 21 days (ending yesterday — today
// isn't over): average intake on counted days, minus the energy of the
// weight change (straight-line rate through the window's weights).
// raw = null when there isn't enough data yet.
function rawMaintenance({ log, intakeByDate, statusByDate, today }) {
  const end = addDaysISO(today, -1);
  const start = addDaysISO(end, -(EST_WINDOW_DAYS - 1));
  const days = [];
  for (let d = start; d <= end; d = addDaysISO(d, 1)) days.push(d);
  const included = days.filter((d) => dayIncluded(d, intakeByDate, statusByDate));
  const weighIns = new Set((log || []).filter((r) => r.date >= start && r.date <= end && Number(r.weight) > 0).map((r) => r.date)).size;
  const daily = dailyWeights(log, end);
  const covered = days.filter((d) => daily[d] != null).length;
  const trend = trendSeries(log, end);
  const base = { includedDays: included.length, weighInDays: weighIns, trendWeight: trend[end] ?? null };
  const lbPerDay = covered >= 14 ? slopePerDay(daily, start, end) : null;
  if (included.length < EST_MIN_INCLUDED || weighIns < EST_MIN_WEIGHINS || lbPerDay == null) return { ...base, raw: null };
  const avgIntake = included.reduce((s, d) => s + intakeByDate[d], 0) / included.length;
  return { ...base, raw: avgIntake - lbPerDay * KCAL_PER_LB, avgIntake, lbPerWeek: lbPerDay * 7 };
}

// This check-in's estimate: move part of the way from the last one (or the
// starting guess) toward the new data, capped per week.
// step: "first" (first data-based check-in after a starting guess),
// "agree" (last week's data pointed the same way), or normal.
function nextEstimate(prior, raw, step = null) {
  if (raw == null) return prior;
  const [k, cap] = step === "first" ? [EST_FIRST_STEP, EST_FIRST_MAX_STEP]
    : step === "agree" ? [EST_STEP_AGREE, EST_MAX_STEP_AGREE]
    : [EST_STEP, EST_MAX_STEP];
  const move = Math.max(-cap, Math.min(cap, k * (raw - prior)));
  return prior + move;
}
// Last week's data and this week's both say the estimate is off the same way.
// Not right after an Adjust: that estimate is your number, not the data's,
// and the faster step would pull you straight back from it.
function estimateAgrees(last, prior, raw) {
  if (!last || last.action === "adjust" || last.estimate_raw == null || raw == null || prior == null) return false;
  const was = Number(last.estimate_raw) - Number(last.estimate), now = raw - prior;
  return Math.abs(was) >= 1 && Math.abs(now) >= 1 && Math.sign(was) === Math.sign(now);
}
// Calories above (or below) maintenance that a phase's target pace needs.
const paceKcal = (ratePctPerWeek, weightLb) => (weightLb ? ((ratePctPerWeek / 100) * weightLb * KCAL_PER_LB) / 7 : 0);

// Macro split for a calorie target (research basis in the plan):
//  protein: never cut; raised to the phase floor if below it
//           (cut ≥2 g/kg bodyweight — Helms 2014; otherwise ≥1.6 g/kg — Morton 2018)
//  fat:     kept, but never under 20% of calories (Helms 2014: 15–30%)
//  carbs:   take the rest
const proteinFloorG = (phaseType, weightLb) => (weightLb ? Math.round(lbToKg(weightLb) * (phaseType === "deficit" ? 2.0 : 1.6)) : 0);
function splitMacros({ cal, current, phaseType, weightLb }) {
  const floorP = proteinFloorG(phaseType, weightLb);
  const p = Math.max(Math.round(current.p), floorP);
  const f = Math.max(Math.round(current.f), fatMinG(cal));
  const c = Math.max(0, Math.round((cal - 4 * p - 9 * f) / 4));
  return { p, f, c, cal: Math.round(cal), proteinRaised: p > Math.round(current.p), fatRaised: f > Math.round(current.f) };
}

// Suggested daily targets: estimate + the calories that produce the phase's
// target rate, capped at ±250 from current; warns if it implies losing
// faster than 1% of bodyweight a week (top of Helms 2014's range).
function suggestTargets({ estimate, ratePctPerWeek, weightLb, current, phaseType, maxChange = CHECKIN_MAX_CHANGE }) {
  const ideal = estimate + paceKcal(ratePctPerWeek, weightLb);
  const cal = Math.max(current.cal - maxChange, Math.min(current.cal + maxChange, ideal));
  const impliedPct = weightLb ? (((cal - estimate) * 7) / KCAL_PER_LB / weightLb) * 100 : 0;
  return {
    ...splitMacros({ cal, current, phaseType, weightLb }),
    ideal: Math.round(ideal),
    maxChange,
    capped: Math.abs(cal - ideal) > 1,
    tooFast: impliedPct < -1,
    impliedPct,
  };
}

/* ---------- phase targets: calories from the rate, macros inside them ----------
   A cut's or bulk's calories come from the maintenance estimate plus what
   its target pace needs; maintenance is the estimate itself. Macros are
   whole grams (4 kcal/g protein and carbs, 9 kcal/g fat) and balance inside
   that fixed calorie target:
     protein or fat changed -> carbs take the difference
     carbs changed          -> fat takes the difference
   Fat is at least 20% of the target's calories (owner's choice, Nov 2026),
   rounded UP to a whole gram so it never lands under 20%: 2,000 kcal ->
   45 g (44 g would be 19.8%), 2,050 -> 46 g, 2,250 -> 50 g. Protein and
   carbs have no hard limits beyond "not below 0"; the protein floor the
   check-in uses (proteinFloorG) is shown as guidance, not enforced. */
const FAT_MIN_SHARE = 0.2;
const macroKcal = (t) => 4 * (Number(t.p) || 0) + 9 * (Number(t.f) || 0) + 4 * (Number(t.c) || 0);
function fatMinG(cal) {
  return Math.max(0, Math.ceil((FAT_MIN_SHARE * (Number(cal) || 0)) / 9 - 1e-9));
}
// Whole grams can't always hit a calorie target exactly (1 g of fat is
// 9 kcal, 1 g of carbs 4), so the macros may total up to half a gram of the
// balancing macro away from it: ±2 kcal when carbs balance, ±4.5 when fat does.
const MACRO_KCAL_TOLERANCE = 4.5;

// A phase's calorie target: estimate + the calories its pace needs, to the
// nearest 10 kcal (as the calculator rounds). null without an estimate, or
// without a weight for a phase that has a pace.
function phaseCalTarget(estimate, ratePctPerWeek, weightLb) {
  if (estimate == null || !Number.isFinite(Number(estimate))) return null;
  if (ratePctPerWeek && !weightLb) return null;
  return Math.round((Number(estimate) + paceKcal(ratePctPerWeek || 0, weightLb)) / 10) * 10;
}

// A preset's default rate (%/week): what new phases started or planned from
// it begin at, and what its saved calories are worked out at while it isn't
// in effect. A phase already on the calendar keeps its own target_rate_pct.
function presetRatePct(preset) {
  if (!preset || (preset.phase_type !== "deficit" && preset.phase_type !== "surplus")) return 0;
  const r = preset.rate_pct;
  return r != null && Number.isFinite(Number(r)) ? Number(r) : defaultRatePct(preset.phase_type, preset.name);
}

// New calories, same protein and fat (fat raised to its minimum if the new
// calories need more), carbs take the rest. Carbs can come out below 0 when
// protein and fat alone are over the calories: checkMacros flags it, and
// with clampCarbs (automatic updates) carbs stop at 0 and `over` says by how much.
function fitMacros(current, cal, { clampCarbs = false } = {}) {
  const p = Math.max(0, Math.round(Number(current.p) || 0));
  const f0 = Math.max(0, Math.round(Number(current.f) || 0));
  const f = Math.max(f0, fatMinG(cal));
  const raw = Math.round((cal - 4 * p - 9 * f) / 4);
  const c = clampCarbs ? Math.max(0, raw) : raw;
  return { p, f, c, cal: Math.round(cal), fatRaised: f > f0, over: raw < 0 ? -raw * 4 : 0 };
}

// One macro edited, calories held: protein or fat -> carbs balance; carbs -> fat.
// The balanced macro isn't clamped, so checkMacros can explain a conflict.
function balanceMacros(t, field, value, cal) {
  const v = Math.max(0, Math.round(Number(value) || 0));
  const next = { p: Math.round(Number(t.p) || 0), f: Math.round(Number(t.f) || 0), c: Math.round(Number(t.c) || 0), [field]: v };
  if (field === "c") next.f = Math.round((cal - 4 * next.p - 4 * next.c) / 9);
  else next.c = Math.round((cal - 4 * next.p - 9 * next.f) / 4);
  return next;
}

// Can this split be saved against `cal`? errors block saving; notes don't.
// limits: the most of each macro that still fits (the others as they are,
// fat at its minimum where it's the one making room).
function checkMacros(t, cal, { phaseType = null, weightLb = null } = {}) {
  const p = Number(t.p), f = Number(t.f), c = Number(t.c);
  const errors = [], notes = [];
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  if (!(cal > 0)) return { ok: false, errors: ["No calorie target to fit the macros into yet."], notes, total: macroKcal(t), fatMin: 0, limits: null };
  const total = macroKcal(t);
  const fatMin = fatMinG(cal);
  // does a split fit: nothing below 0, fat at its minimum (of the target or,
  // if rounding puts the total above it, of the total), total within tolerance
  const fits = (x) => x.p >= 0 && x.c >= 0 && x.f >= fatMinG(Math.max(cal, macroKcal(x))) && Math.abs(macroKcal(x) - cal) <= MACRO_KCAL_TOLERANCE;
  // the most of `field` that still fits once balanced (start from the
  // algebraic bound and step down past any rounding edge)
  const most = (base, field, guess) => {
    for (let v = Math.floor(guess) + 1; v >= 0; v--) if (fits(balanceMacros(base, field, v, cal))) return v;
    return null;
  };
  const base = { p: Math.max(0, p || 0), f: Math.max(0, f || 0), c: Math.max(0, c || 0) };
  const limits = {
    p: most(base, "p", (cal - 9 * base.f) / 4),                                   // carbs balance, down to 0
    pAtFatMin: most({ ...base, f: fatMin }, "p", (cal - 9 * fatMin) / 4),         // the same with fat at its minimum
    f: most(base, "f", (cal - 4 * base.p) / 9),                                   // carbs balance, down to 0
    c: most(base, "c", (cal - 4 * base.p - 9 * fatMin) / 4 + 1),                  // fat balances, down to its minimum
  };
  const lim = (v) => fmt(Math.max(0, v ?? 0));
  if (![p, f, c].every(Number.isFinite)) errors.push("Enter protein, fat and carbs as numbers.");
  else {
    if (p < 0) errors.push("Protein can't be below 0 g.");
    if (c < 0) {
      errors.push(`Protein ${fmt(p)} g and fat ${fmt(f)} g already come to ${fmt(4 * p + 9 * f)} kcal, over the ${fmt(cal)} kcal target, so carbs would be below 0. `
        + (limits.f != null && limits.f >= fatMin
          ? `Lower fat to ${lim(limits.f)} g or less, or protein to ${lim(limits.p)} g or less.`
          : `Fat can't go under its ${fmt(fatMin)} g minimum, so lower protein to ${lim(limits.pAtFatMin)} g or less.`));
    }
    const fatNeed = fatMinG(Math.max(cal, total));
    if (f < fatNeed) {
      errors.push(`Fat would be ${fmt(f)} g, under its ${fmt(fatNeed)} g minimum (20% of ${fmt(Math.max(cal, total))} kcal). `
        + (limits.c != null ? `With protein at ${fmt(p)} g, carbs can be ${lim(limits.c)} g at most.` : `Protein ${fmt(p)} g leaves no room for it: lower protein to ${lim(limits.pAtFatMin)} g or less.`));
    }
    if (!errors.length && Math.abs(total - cal) > MACRO_KCAL_TOLERANCE) {
      errors.push(`These macros total ${fmt(total)} kcal, ${fmt(Math.abs(total - cal))} ${total > cal ? "over" : "under"} the ${fmt(cal)} kcal target.`);
    }
    const floorP = phaseType ? proteinFloorG(phaseType, weightLb) : 0;
    if (floorP && p >= 0 && p < floorP) {
      notes.push(`Protein is under the ${fmt(floorP)} g (${phaseType === "deficit" ? "2.0" : "1.6"} g/kg) the weekly check-in raises it to${phaseType === "deficit" ? " on a cut" : ""}. You can still save it.`);
    }
  }
  return { ok: !errors.length, errors, notes, total, fatMin, limits };
}

// A target recalculated for new calories, recording what it was calculated
// from and what it replaced, so the card can say what changed and why.
function refitTarget(preset, cal, info) {
  const t = fitMacros(preset.target, cal, { clampCarbs: true });
  const target = { p: t.p, f: t.f, c: t.c, cal: t.cal };
  if (sameTarget(target, preset.target)) return null;
  return { target, fit: { ...info, from: { ...preset.target }, fatRaised: t.fatRaised, over: t.over } };
}

// Inactive presets follow the maintenance estimate: each phase preset not in
// effect today is recalculated at its own default rate (cuts and bulks) or
// at the estimate (maintenance). Protein and fat stay (fat up to its
// minimum), carbs take the change. Day targets (refeeds) are left alone:
// they're set directly. Run when a check-in records a new estimate from
// your data; the same array back when nothing changed.
function realignPresets(presets, { estimate, weightLb, skipIds = [], date, reason = "estimate", source = "learned" }) {
  if (estimate == null) return presets;
  let changed = false;
  const next = (presets || []).map((p) => {
    if (skipIds.includes(p.id) || !isPhaseType(p.phase_type)) return p;
    const rate = presetRatePct(p);
    const cal = phaseCalTarget(estimate, rate, weightLb);
    if (cal == null) return p;
    const r = refitTarget(p, cal, { date, reason, estimate: Math.round(estimate), source, ratePct: roundRate(rate), weightLb: weightLb ? r1(weightLb) : null });
    if (!r) return p;
    changed = true;
    return { ...p, target: r.target, fit: r.fit, example: false };
  });
  return changed ? next : presets;
}

// When a phase comes into effect (switched to, or a planned phase's start
// date arrives) its preset gets a fresh target: the current estimate plus
// that phase's OWN rate (row.target_rate_pct), not whatever the preset last
// held. startedFor remembers the diet_phases row it was done for, so it
// happens once per phase. The first time this runs for an account (no
// preset has startedFor yet) it only records where things stand: the phase
// already in effect keeps its target. Without an estimate (or a weight, for
// a cut or bulk) the saved target is kept. The same array back when nothing changed.
function phaseStartUpdate(presets, { row, estimate, weightLb, date, source = null }) {
  let next = presets || [];
  let changed = false;
  if (next.some((p) => p.startedFor === undefined)) {
    next = next.map((p) => (p.startedFor !== undefined ? p : { ...p, startedFor: row && p.id === row.phase_id ? row.id : null }));
    changed = true;
  }
  const p = row ? next.find((x) => x.id === row.phase_id) : null;
  if (p && p.startedFor !== row.id) {
    const rate = row.phase_type === "maintenance" ? 0 : phaseRatePct(row);
    const cal = phaseCalTarget(estimate, rate, weightLb);
    const r = cal == null ? null : refitTarget(p, cal, { date, reason: "start", estimate: Math.round(estimate), source, ratePct: roundRate(rate), weightLb: weightLb ? r1(weightLb) : null });
    next = next.map((x) => (x.id !== p.id ? x : r ? { ...x, target: r.target, fit: r.fit, startedFor: row.id, example: false } : { ...x, startedFor: row.id }));
    changed = true;
  }
  return changed ? next : presets;
}

// The phase in effect changes pace (Phases editor, calendar): its calories
// move by the difference in what the two paces need at this weight, from
// the target you have now, so a check-in's step still in progress (or a
// Keep) carries over instead of jumping. Same as "Slow to 0.5%/week".
function shiftForRate(target, oldRatePct, newRatePct, weightLb) {
  const delta = paceKcal(newRatePct, weightLb) - paceKcal(oldRatePct, weightLb);
  return Math.round(Number(target.cal) + delta);
}

// Where the maintenance estimate behind the targets comes from: the latest
// recorded check-in (from your data, or your Edit), else your Maintenance
// target as a starting estimate, else none.
function estimateBasis({ checkins, maintenance }) {
  const sorted = [...(checkins || [])].sort((a, b) => (a.week_start < b.week_start ? -1 : 1));
  const last = sorted[sorted.length - 1] || null;
  if (last && last.estimate != null) {
    const learned = sorted.some((c) => c.estimate_raw != null);
    return { kcal: Number(last.estimate), source: last.action === "adjust" ? "adjusted" : learned ? "learned" : "starting", asOf: last.week_start };
  }
  if (maintenance && !maintenance.example && Number(maintenance.target?.cal) > 0) return { kcal: Number(maintenance.target.cal), source: "starting", asOf: null };
  return null;
}

// What a completed check-in does. Use and Edit set the phase's target; an
// Edit that keeps the suggested calories only changes the split, so it's
// recorded as a Use and doesn't move the estimate (an Edit with different
// calories makes them the estimate, less the pace: "your Adjust sticks").
// Keep changes nothing in effect. Either way, once the estimate rests on
// your data, the presets not in effect follow it.
function checkinOutcome({ action, chosen, c, presets, date }) {
  let act = action;
  if (act === "adjust" && chosen && c.suggestion && Math.round(chosen.cal) === Math.round(c.suggestion.cal)) act = "apply";
  const estimate = act === "adjust" && chosen?.cal != null ? chosen.cal - paceKcal(c.ratePct, c.weightLb) : c.estimate;
  let next = presets;
  if (act !== "keep" && chosen) {
    next = next.map((p) => (p.id === c.followed.id
      ? { ...p, target: { p: chosen.p, f: chosen.f, c: chosen.c, cal: chosen.cal }, fit: { date, reason: "checkin", estimate: Math.round(estimate), source: act === "adjust" ? "adjusted" : "learned", ratePct: roundRate(c.ratePct), weightLb: c.weightLb ? r1(c.weightLb) : null, from: { ...p.target } } }
      : p));
  }
  if (c.grounded && estimate != null) {
    next = realignPresets(next, { estimate, weightLb: c.weightLb, skipIds: [c.followed.id], date, reason: "estimate", source: act === "adjust" ? "adjusted" : "learned" });
  }
  return { action: act, estimate, presets: next };
}

/* ---------- starting targets calculator ----------
   A first estimate of maintenance from a short profile, used to fill the
   presets so a new account starts from its own numbers. The weekly
   check-in corrects it once there are a few weeks of log and weigh-ins.
   - Calories at rest: Mifflin-St Jeor (best-validated for the general
     population, ~±10% for most non-obese adults: Frankenfield 2005). With
     a body-fat %, Tinsley 2019's lean-mass equation (25.9 × FFM + 284):
     weight-only equations underestimate muscular people.
   - Daily movement outside the gym (and digesting food): × 1.3 / 1.45 /
     1.6 / 1.75 — standard activity-factor conventions, not measurements.
   - Lifting, added on top: ~1 hour at ~5 METs (Compendium of Physical
     Activities, resistance training), net of resting: 4 kcal/kg/session,
     averaged over the week. */
const MOVEMENT_LEVELS = [
  { id: "sitting", factor: 1.3, label: "Mostly sitting", desc: "desk job, studying, driving. Under ~5,000 steps." },
  { id: "walking", factor: 1.45, label: "Some walking", desc: "up and about part of the day, e.g. teaching, errands, a walk most days. ~5,000–10,000 steps." },
  { id: "feet", factor: 1.6, label: "On your feet most of the day", desc: "retail, nursing, serving, warehouse. ~10,000–15,000 steps." },
  { id: "physical", factor: 1.75, label: "Physical work", desc: "construction, landscaping, moving heavy things. 15,000+ steps." },
];
const LIFT_KCAL_PER_KG = 4;
const inToCm = (i) => i * 2.54;

function estimateMaintenance({ sex, age, heightIn, weightLb, bodyFatPct, movement, liftDays }) {
  const kg = lbToKg(weightLb);
  const lean = bodyFatPct > 0 && bodyFatPct < 70;
  const rest = lean
    ? 25.9 * kg * (1 - bodyFatPct / 100) + 284
    : 10 * kg + 6.25 * inToCm(heightIn) - 5 * age + (sex === "female" ? -161 : 5);
  const level = MOVEMENT_LEVELS.find((m) => m.id === movement) || MOVEMENT_LEVELS[0];
  const lifting = ((liftDays || 0) / 7) * LIFT_KCAL_PER_KG * kg;
  const total = Math.round((rest * level.factor + lifting) / 10) * 10;
  return { rest: Math.round(rest), method: lean ? "lean mass" : "Mifflin-St Jeor", daily: Math.round(rest * level.factor), lifting: Math.round(lifting), total };
}

// Every phase-type preset's targets from a maintenance number: calories
// for its default rate (or maintenance, for maintenance and day presets),
// protein at the phase floor, fat 20% on a cut / 25% otherwise (Helms
// 2014: 15–30%), carbs the rest.
function targetsFromMaintenance(preset, maintenance, weightLb) {
  const type = preset.phase_type;
  const rate = presetRatePct(preset);
  const cal = Math.round((maintenance + (rate / 100) * weightLb * KCAL_PER_LB / 7) / 10) * 10;
  const fatShare = type === "deficit" || type === "day" ? 0.2 : 0.25; // refeeds: carbs, not fat
  const { p, f, c } = splitMacros({ cal, current: { p: 0, f: Math.round((fatShare * cal) / 9) }, phaseType: type, weightLb });
  return { p, f, c, cal };
}


async function sbLoadIntakeRange(session, from, to) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/intake_log?select=date,qty,cal,p&user_id=eq.${session.user.id}&date=gte.${from}&date=lte.${to}`,
    { headers: sbHeaders(session) }
  );
  if (!res.ok) throw new Error("Failed to load food log: " + res.status);
  return res.json();
}

async function sbLoadDayStatus(session, from) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/day_status?select=date,included&user_id=eq.${session.user.id}&date=gte.${from}`,
    { headers: sbHeaders(session) }
  );
  if (!res.ok) throw new Error("Failed to load day status: " + res.status);
  return res.json();
}

async function sbSetDayStatus(session, date, included) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/day_status?on_conflict=user_id,date`, {
    method: "POST",
    headers: sbHeaders(session, { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ user_id: session.user.id, date, included }),
  });
  if (!res.ok) throw new Error("Failed to save day status: " + res.status);
}

// Whether a RepReport training block is running (same Supabase project and
// user): { active, daysPerWeek, lastDaysPerWeek, deload }, or null with no
// RepReport data. deload: the block's current week is its deload week.
// RepReport saves this as `status` (its buildTrainingStatus): a block
// that's finished but not yet archived or replaced isn't active. Rows saved
// before that existed fall back to the block's own days — a live meso counts
// as active there, since telling finished from running would mean
// downloading every week.
// RepReport's status.strength, or null when it isn't usable: a malformed one
// (a corrupt row, or a RepReport change without the matching one here) must
// not break the phase card.
function validStrength(st) {
  if (!st || typeof st !== "object" || typeof st.level !== "string" || typeof st.cutStart !== "string") return null;
  const num = (n) => (typeof n === "number" && Number.isFinite(n) ? n : null);
  const lift = (x) => (x && typeof x === "object" && num(x.weight) != null && num(x.reps) != null && num(x.rir) != null ? x : null);
  const lifts = (a) => (Array.isArray(a) && a.length && a.every(lift) ? a : null);
  // beforeSets/afterSets: both sets RepReport scored (older RepReport sends only before/after)
  const ex = st.example && typeof st.example === "object" && lift(st.example.before) && lift(st.example.after)
    ? { ...st.example, beforeSets: lifts(st.example.beforeSets), afterSets: lifts(st.example.afterSets) }
    : null;
  const changePct = num(st.changePct);
  const musclesScored = num(st.musclesScored) ?? 0;
  // a warning needs a change and at least 3 muscles behind it, as RepReport requires
  return { ...st, changePct, musclesDown: num(st.musclesDown) ?? 0, musclesScored,
    level: changePct == null || musclesScored < 3 ? "none" : st.level, example: ex };
}

// RepReport's half of the goal check (its buildGoalStatus), or null when
// it's missing or malformed. Labels are plain words RepReport chose.
function validGoal(g) {
  if (!g || typeof g !== "object" || typeof g.primaryGoal !== "string") return null;
  const words = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && x) : []);
  const f = g.focus && typeof g.focus === "object" ? g.focus : {};
  const iso = (x) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);
  const b = g.block && typeof g.block === "object" && iso(g.block.start) && iso(g.block.end)
    ? { start: g.block.start, end: g.block.end, weeks: Number.isFinite(g.block.weeks) ? g.block.weeks : null, deloadStart: iso(g.block.deloadStart) ? g.block.deloadStart : null }
    : null;
  const focus = { emphasize: words(f.emphasize), primary: words(f.primary), maintain: words(f.maintain) };
  if (!focus.emphasize.length && !focus.primary.length && !focus.maintain.length) return null; // nothing to judge by
  return { primaryGoal: g.primaryGoal, focus, mainLifts: words(g.mainLifts), block: b };
}

async function sbLoadTrainingStatus(session) {
  const url = (select) => `${SUPABASE_URL}/rest/v1/training_data?select=${select}&user_id=eq.${session.user.id}`;
  const res = await fetch(url("status:data->status->data"), { headers: sbHeaders(session) });
  if (!res.ok) return null;
  const [row] = await res.json();
  if (!row) return null;
  const capDays = (n) => (n ? Math.min(7, n) : null);
  if (row.status && typeof row.status.active === "boolean") {
    const st = validStrength(row.status.strength);
    return {
      active: row.status.active,
      daysPerWeek: capDays(row.status.daysPerWeek),
      lastDaysPerWeek: capDays(row.status.lastDaysPerWeek),
      deload: !!row.status.deload,
      // RepReport's cut strength check (its computeCutStrength); null
      // outside a cut and on status saved before it existed
      strength: st,
      // the running block's goal (its buildGoalStatus); null without one
      goal: row.status.active ? validGoal(row.status.goal) : null,
    };
  }
  const legacy = await fetch(url("cur:data->meso->data->weeks->0->days,arch:data->archive->data->0->weeks->0->days"), { headers: sbHeaders(session) });
  if (!legacy.ok) return null;
  const [old] = await legacy.json();
  const cur = Array.isArray(old?.cur) && old.cur.length ? old.cur.length : null;
  const arch = Array.isArray(old?.arch) && old.arch.length ? old.arch.length : null;
  return { active: cur != null, daysPerWeek: capDays(cur), lastDaysPerWeek: capDays(cur ?? arch), deload: false, strength: null, goal: null };
}

// A day's logged protein (g), or null when any food's protein is unknown
// (a calories-only quick add).
const dayProtein = (rows) => (rows.some((r) => r.p == null) ? null : rows.reduce((n, r) => n + Number(r.qty) * Number(r.p), 0));

// The protein summary RepReport reads (see the Root's proteinStatus):
// the 7 days ending yesterday, days that count toward the estimate and
// have a protein total. Target: each day's preset (the weekday's override,
// else the diet phase's), as it was that day.
function buildProteinStatus({ today, intakeByDate, statusByDate, proteinByDate, presets, targetHistory, dietPhases, planStore }) {
  const asOf = addDaysISO(today, -1);
  const targetOn = (d) => {
    const dated = presetsAsOf(presets, targetHistory, d);
    const ph = phaseOnDate(dietPhases, d);
    const day = planStore ? planFor(planStore, mondayOf(d))?.[weekdayKey(d)] : null;
    const preset = (day?.targetId && dated.find((p) => p.id === day.targetId)) || (ph && dated.find((p) => p.id === ph.phase_id)) || null;
    return preset ? Number(preset.target.p) || null : null;
  };
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDaysISO(asOf, -i);
    if (!(intakeByDate[d] > 0) || statusByDate[d] === false || proteinByDate[d] == null) continue;
    days.push({ g: proteinByDate[d], target: targetOn(d) });
  }
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const targets = days.map((x) => x.target).filter((t) => t != null);
  return {
    version: 1, asOf, daysLogged: days.length,
    proteinAvg: days.length ? Math.round(avg(days.map((x) => x.g))) : null,
    proteinTarget: targets.length ? Math.round(avg(targets)) : null,
  };
}

// Write the summary RepReport reads (app_data.status): only that column,
// so it never touches updated_at or the plan/foods save-conflict check.
// No row yet (a new account before its first save) → nothing is written.
async function sbSaveStatus(session, status) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_data?user_id=eq.${session.user.id}`, {
    method: "PATCH",
    headers: sbHeaders(session, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error("Failed to save status for RepReport: " + res.status);
}

async function sbLoadCheckins(session) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/checkins?select=week_start,estimate,estimate_raw,included_days,weigh_in_days,actual_rate_pct,target_rate_pct,preset_id,before,suggested,chosen,action,created_at&user_id=eq.${session.user.id}&order=week_start.asc`,
    { headers: sbHeaders(session) }
  );
  if (!res.ok) throw new Error("Failed to load check-ins: " + res.status);
  return res.json();
}

async function sbDeleteCheckin(session, weekStart) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/checkins?user_id=eq.${session.user.id}&week_start=eq.${weekStart}`, {
    method: "DELETE",
    headers: sbHeaders(session, { Prefer: "return=minimal" }),
  });
  if (!res.ok) throw new Error("Failed to withdraw check-in: " + res.status);
}

async function sbUpdateCheckin(session, weekStart, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/checkins?user_id=eq.${session.user.id}&week_start=eq.${weekStart}`, {
    method: "PATCH",
    headers: sbHeaders(session, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Failed to update check-in: " + res.status);
}

async function sbInsertCheckin(session, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/checkins`, {
    method: "POST",
    headers: sbHeaders(session, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ ...row, user_id: session.user.id }),
  });
  if (!res.ok) throw new Error("Failed to save check-in: " + res.status);
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

// Not seeded any more: new accounts start with no foods (owner decision, Oct 2026).
// Kept in case it comes back as an optional "add starter foods" action.
const SEED_ALL = [...SEED_FOODS, ...SEED_RECIPES];

// phase_type is what the diet-phase calendar keys on — presets without one
// never show up in its "phase…" picker, so every seeded preset needs it.
// "day" = day targets only (e.g. a refeed): offered in a day's TARGETS menu
// but never as a diet phase, so RepReport can't mistake a refeed for a cut.
const SEED_PHASE_TYPES = {
  "phase-minicut": "deficit",
  "phase-cut": "deficit",
  "phase-maintenance": "maintenance",
  "phase-bulk": "surplus",
  "phase-weekend": "day",
};
const isPhaseType = (t) => t === "deficit" || t === "maintenance" || t === "surplus";
const PRESET_USES = [
  ["deficit", "Cut phase"],
  ["maintenance", "Maintenance phase"],
  ["surplus", "Bulk phase"],
  ["day", "Day override only (e.g. refeed)"],
];
const SEED_PHASES = [
  ph("Mini-cut",       155, 42, 226, 1902, "phase-minicut"),
  ph("Cut",            155, 52, 316, 2352, "phase-cut"),
  ph("Maintenance",    133, 71, 345, 2551, "phase-maintenance"),
  ph("Bulk",           133, 78, 392, 2802, "phase-bulk"),
  ph("Weekend/Refeed", 126, 90, 422, 3002, "phase-weekend"),
];
// New accounts start with these as examples: `example` marks targets the
// person hasn't set themselves, so nothing treats them as their real
// maintenance (the estimate's starting guess, the % vs maintenance).
// Editing a preset's numbers clears it.
function ph(name, p, f, c, cal, stableId) {
  return { id: stableId || uid(), name, phase_type: SEED_PHASE_TYPES[stableId], target: { p, f, c, cal }, example: true, startedFor: null };
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
// source day's slots. Entries carry no id (just {foodId, qty}). Slot ids
// are React keys and also line a day's food log up under its meals
// (intake_log.slot_id); they carry across weeks (see planFor) and are
// cloned as-is here, which is fine since each day's log is grouped
// separately. A full replace is simplest and safest (idempotent, no risk of
// a merge duplicating entries if the action is triggered twice).
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

/* ---------- the weekly plan, one per week ----------
   Saved in app_data.week as { v: 2, plans: { "<Monday ISO>": { Mon..Sun } } }.
   Each week starts with no foods: a week you haven't edited shows the meals
   and day targets of the latest saved week before it (or, before your first
   saved week, of that first week), with every meal empty, and it's only
   saved once you change it. Keeping the same meals (and their ids) means a
   day's food log still lines up under its meals. Copying fills an empty day
   from the latest earlier week that had foods planned on that weekday.
   Before v2 the plan was one repeating Mon–Sun template; on load it becomes
   last week's plan, so the current week starts empty with that template
   one tap away. */
// Past weeks whose foods are kept. Older weeks keep their meals and day
// targets (so old logs still line up), except the week each weekday would
// copy from, which keeps its foods too.
const PLAN_KEEP_WEEKS = 12;
function seedWeek() {
  const w = {};
  DAYS.forEach((d) => (w[d] = newDay()));
  return w;
}
const isPlanStore = (w) => !!w && w.v === 2 && !!w.plans && typeof w.plans === "object";
// A saved Mon–Sun plan, made whole: missing days get default meals, and days
// saved before targets followed the diet phase lose their per-weekday phaseId
// (it was always set, default Maintenance); a deliberate override is re-picked
// in the TARGETS dropdown. idRemap: old preset ids to stable ones.
function cleanWeek(days, idRemap = {}) {
  const out = {};
  for (const d of DAYS) {
    const val = days?.[d];
    if (!val || typeof val !== "object" || !Array.isArray(val.slots)) { out[d] = newDay(); continue; }
    const { phaseId, ...rest } = val;
    const targetId = "targetId" in val ? val.targetId : null;
    out[d] = { ...rest, targetId: targetId ? idRemap[targetId] || targetId : null };
  }
  return out;
}
// whatever app_data.week holds (v2, the old single template, or nothing) as a v2 store
function loadPlanStore(raw, today, idRemap = {}) {
  const plans = {};
  if (isPlanStore(raw)) {
    for (const [k, days] of Object.entries(raw.plans)) if (/^\d{4}-\d{2}-\d{2}$/.test(k)) plans[k] = cleanWeek(days, idRemap);
  } else if (raw && typeof raw === "object" && DAYS.some((d) => raw[d])) {
    plans[addDaysISO(mondayOf(today), -7)] = cleanWeek(raw, idRemap);
  }
  if (!Object.keys(plans).length) plans[mondayOf(today)] = seedWeek();
  return { v: 2, plans };
}
const dayHasFoods = (day) => !!day && day.slots.some((s) => s.entries.length > 0);
const weekHasFoods = (days) => !!days && DAYS.some((d) => dayHasFoods(days[d]));
// the plan for the week starting `monday` (see above)
function planFor(store, monday) {
  const plans = store.plans;
  if (plans[monday]) return plans[monday];
  const keys = Object.keys(plans).sort();
  const src = keys.filter((k) => k < monday).pop() || keys.find((k) => k > monday);
  if (!src) return seedWeek(); // not reached: a loaded store always has a plan
  const w = {};
  for (const d of DAYS) w[d] = { ...plans[src][d], slots: plans[src][d].slots.map((sl) => ({ ...sl, entries: [] })) };
  return w;
}
const stripFoods = (days) => {
  const w = {};
  for (const d of DAYS) w[d] = { ...days[d], slots: days[d].slots.map((sl) => ({ ...sl, entries: [] })) };
  return w;
};
// For each weekday, the latest week before `monday` with foods planned that
// day: { days: { Mon: <that day>, ... }, from: { Mon: "<its Monday>", ... } },
// or null when no earlier week has any foods.
function lastPlannedDays(store, monday) {
  const keys = Object.keys(store.plans).filter((k) => k < monday).sort();
  const days = {}, from = {};
  for (const d of DAYS) {
    for (let i = keys.length - 1; i >= 0; i--) {
      if (dayHasFoods(store.plans[keys[i]][d])) { days[d] = store.plans[keys[i]][d]; from[d] = keys[i]; break; }
    }
  }
  return Object.keys(from).length ? { days, from } : null;
}
// Whether a week's planned foods are kept when saved (see PLAN_KEEP_WEEKS).
function planKeepsFoods(store, monday, today) {
  if (monday >= addDaysISO(mondayOf(today), -7 * PLAN_KEEP_WEEKS)) return true;
  const src = lastPlannedDays(store, mondayOf(today));
  return !!src && Object.values(src.from).includes(monday);
}
// Save `days` as the plan for `monday`. Weeks older than PLAN_KEEP_WEEKS lose
// their foods (not their meals or targets), except each weekday's copy
// source; an old week whose meals and targets match the saved week before it
// is dropped, since it would show the same anyway.
function withPlan(store, monday, days, today) {
  const plans = { ...store.plans, [monday]: days };
  const cur = mondayOf(today);
  const oldest = addDaysISO(cur, -7 * PLAN_KEEP_WEEKS);
  const keep = new Set(Object.keys(plans).filter((k) => k >= oldest));
  Object.values(lastPlannedDays({ plans }, cur)?.from || {}).forEach((k) => keep.add(k));
  let prev = null;
  for (const k of Object.keys(plans).sort()) {
    if (!keep.has(k)) {
      const bare = stripFoods(plans[k]);
      if (prev && JSON.stringify(stripFoods(prev)) === JSON.stringify(bare)) { delete plans[k]; continue; }
      plans[k] = bare;
    }
    prev = plans[k];
  }
  return { ...store, plans };
}
// The latest week before `monday` whose `dayKey` has foods in the meal
// matching `slot` (by id, then name): { monday, entries } or null.
function lastPlannedMeal(store, monday, dayKey, slot) {
  const keys = Object.keys(store.plans).filter((k) => k < monday).sort();
  for (let i = keys.length - 1; i >= 0; i--) {
    const slots = store.plans[keys[i]][dayKey]?.slots || [];
    const m = slots.find((x) => x.id === slot.id) || slots.find((x) => x.name === slot.name);
    if (m?.entries.length) return { monday: keys[i], entries: m.entries };
  }
  return null;
}
// Copy `source`'s foods into the days of `target` that have none planned:
// each meal matched by id, then by name, else added. Days you've already
// planned and every day's targets are left alone.
function copyFoodsInto(target, source, dayKeys = DAYS) {
  const next = { ...target };
  for (const d of dayKeys) {
    const t = target[d], src = source?.[d];
    if (!t || dayHasFoods(t) || !dayHasFoods(src)) continue;
    const slots = JSON.parse(JSON.stringify(t.slots));
    for (const ss of src.slots) {
      if (!ss.entries.length) continue;
      let i = slots.findIndex((x) => x.id === ss.id);
      if (i < 0) i = slots.findIndex((x) => x.name === ss.name);
      if (i >= 0) slots[i].entries = JSON.parse(JSON.stringify(ss.entries));
      else slots.push(JSON.parse(JSON.stringify(ss)));
    }
    next[d] = { ...t, slots };
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
   CONSENT SCREEN — 18+ and terms, once per account (shared with RepReport)
   ============================================================ */
function ConsentScreen({ session, onConfirmed, onSignOut }) {
  const [isAdult, setIsAdult] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      onConfirmed(await sbRecordConsent(session));
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  const checkRow = { display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12, cursor: "pointer", fontSize: 14, lineHeight: 1.5, color: "#e8efe9" };
  const box = { marginTop: 3, accentColor: "#46e6a0", flexShrink: 0 };
  const link = { color: "#46e6a0" };
  return (
    <div style={{...S.app, display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh"}}>
      <Style />
      <div style={{...S.modal, maxWidth: 360, position:"static", margin:"0 16px"}}>
        <div style={{padding: 24}}>
          <div style={S.brand}>
            <span style={S.brandMark}>◢</span>
            <div>
              <div style={S.brandName}>MEAL&nbsp;PREP</div>
              <div style={S.brandSub}>before you start</div>
            </div>
          </div>
          <p style={S.note}>
            Meal Prep and RepReport give general nutrition and training suggestions, not medical
            advice. One confirmation covers both apps.
          </p>
          <label style={checkRow}>
            <input type="checkbox" checked={isAdult} onChange={(e) => setIsAdult(e.target.checked)} style={box} />
            <span>I'm 18 or older.</span>
          </label>
          <label style={{...checkRow, marginBottom: 16}}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={box} />
            <span>
              I agree to the <a href={TERMS_URL} target="_blank" rel="noreferrer" style={link}>Terms of Use</a> and
              have read the <a href={PRIVACY_URL} target="_blank" rel="noreferrer" style={link}>Privacy Policy</a>.
            </span>
          </label>
          <button style={{...S.primaryBtn, width:"100%", marginBottom: 8}} onClick={submit} disabled={!isAdult || !agreed || busy}>
            {busy ? "saving…" : "continue"}
          </button>
          <button style={{...S.ghostBtn, width:"100%"}} onClick={onSignOut}>
            sign out{session.user?.email ? ` (${session.user.email})` : ""}
          </button>
          {err && <div style={{...S.verifyBanner, marginTop: 12}}>{err}</div>}
          <p style={{...S.note, fontSize: 12, marginTop: 16, marginBottom: 0}}>
            Under 18? Please don't use the apps. Email us and we'll delete this account.
          </p>
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
  const storeRef = useRef(null); // the latest store, for async checks outside render
  storeRef.current = store;
  const [loaded, setLoaded] = useState(false);
  // The date being viewed in Plan. Each week has its own Mon–Sun plan (see
  // planFor), so a date resolves to its weekday in that week's plan; the
  // date also picks the week strip, the month calendar, and which diet
  // phase that day falls in.
  const [selectedDate, setSelectedDate] = useState(() => todayISO());
  const activeDay = weekdayKey(selectedDate);
  const setActiveDay = (dayKey) =>
    setSelectedDate(addDaysISO(mondayOf(selectedDate), DAYS.indexOf(dayKey)));
  const [showMonth, setShowMonth] = useState(false);
  // starting-targets calculator: open state, and RepReport's block status (null = none)
  const [calc, setCalc] = useState(null);
  const [savedProfile, setSavedProfile] = useState(null); // this session's save; else user_metadata
  const [calcLater, setCalcLater] = useState(() => { try { return localStorage.getItem("mealprep:calc-later") === "1"; } catch { return false; } });
  const openCalc = async () => {
    let status = null;
    try { status = await sbLoadTrainingStatus(session); } catch { /* no RepReport data */ }
    if (status) setTraining(status);
    setCalc({ training: status });
  };
  const applyCalc = async (targets, profile) => {
    setPhases((prev) => prev.map((p) => (targets[p.id] ? { ...p, target: targets[p.id], example: false } : p)));
    setCalc(null);
    setSavedProfile(profile);
    // kept on the account for next time; not via setSession, which would re-run the data loads
    try {
      const next = await sbUpdateUserMeta(session, { profile });
      localStorage.setItem(SESSION_KEY, JSON.stringify({ access_token: next.access_token, refresh_token: next.refresh_token, user: next.user }));
    } catch { /* the targets are saved either way */ }
  };
  const laterCalc = () => { setCalcLater(true); try { localStorage.setItem("mealprep:calc-later", "1"); } catch { /* private mode */ } };
  // onboarding flags (user_metadata.mealprep_onboarding); null until decided
  const [ob, setOb] = useState(null);
  const [dietLoaded, setDietLoaded] = useState(false);
  const [setup, setSetup] = useState(null); // { step: "phase" | "calc" | "next" | "weigh", type, weight }
  const obRef = useRef(null); // the latest flags, so quick successive saves don't drop one another
  const [tipOpen, setTipOpen] = useState(null);           // "pace" | "firstTargets", opened from a banner
  const [whatsNextLater, setWhatsNextLater] = useState(false); // "later" on the What's next card, this visit
  const cutStartedRef = useRef(false); // a cut started this visit: its tip waits for the next app open
  const saveOb = async (next) => {
    obRef.current = next;
    setOb(next);
    try {
      const s2 = await sbUpdateUserMeta(session, { mealprep_onboarding: next });
      localStorage.setItem(SESSION_KEY, JSON.stringify({ access_token: s2.access_token, refresh_token: s2.refresh_token, user: s2.user }));
    } catch (e) { dbg("onboarding flags save FAILED: " + e.message); }
  };
  // mark one or more flags seen: markOb(["tips", "pace"], ["banners", "pace"])
  const markOb = (...pairs) => {
    const cur = obRef.current;
    if (!cur) return;
    const next = { ...cur };
    for (const [group, key] of pairs) next[group] = { ...(next[group] || {}), [key]: true };
    saveOb(next);
  };
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
  const [training, setTraining] = useState(null);     // RepReport block status (sbLoadTrainingStatus); null = unknown/none
  const [strengthAnswer, setStrengthAnswer] = useState(null); // this session's answer to the strength suggestion (see strengthChoice)
  const [intake, setIntake] = useState({});           // food log rows by date (loaded on demand)
  const [targetHistory, setTargetHistory] = useState([]); // target_history rows, oldest first
  const [historyReady, setHistoryReady] = useState(false); // target history loaded: target changes can be dated
  const [bwLoaded, setBwLoaded] = useState(false);         // weigh-ins loaded at least once
  // latest history for the save path (its closure can be a render behind), and
  // whether it loaded — never record against a history we failed to read
  const historyRef = useRef({ loaded: false, rows: [] });
  useEffect(() => { historyRef.current.rows = targetHistory; }, [targetHistory]);
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
  // Set the moment account deletion starts, so no save (including one
  // already debounced) can recreate the deleted rows.
  const accountGoneRef = useRef(false);
  const queueSave = (data) => {
    const run = saveChainRef.current.then(async () => {
      if (accountGoneRef.current) return; // account deleted — never write it back
      const json = JSON.stringify(data);
      if (json === savedRef.current.json) return;
      const updatedAt = await sbSaveAppData(session, data, savedRef.current.updatedAt);
      savedRef.current = { updatedAt, json };
      dbg("saved to supabase — foods:" + data.foods?.length + " phases:" + data.phases?.length);
      recordTargetChanges(data.phases || []);
    });
    saveChainRef.current = run.catch(() => {}); // a failed save mustn't block the next
    return run;
  };

  // After a save: compare each preset with its latest history row and
  // date-stamp any target that differs (a new preset gets its baseline).
  // Compared against history, not the previous save, so paths without a
  // previous copy (e.g. "keep mine") can't overwrite real baselines. Never
  // blocks the save; a failure shows a banner.
  const recordTargetChanges = async (next) => {
    if (!historyRef.current.loaded) return;
    const today = todayISO();
    const rows = [];
    for (const p of next) {
      let latest = null;
      for (const h of historyRef.current.rows) {
        if (h.preset_id === p.id && (!latest || h.effective_date > latest.effective_date)) latest = h;
      }
      if (!latest) rows.push(historyRow(p, BASELINE_DATE));
      else if (!sameTarget(latest, p.target)) rows.push(historyRow(p, today));
    }
    if (!rows.length) return;
    try {
      await sbUpsertTargetHistory(session, rows);
      const key = (r) => r.preset_id + "|" + r.effective_date;
      const merged = new Map(historyRef.current.rows.map((r) => [key(r), r]));
      rows.forEach((r) => merged.set(key(r), r));
      const all = [...merged.values()].sort((a, b) => (a.effective_date < b.effective_date ? -1 : 1));
      historyRef.current.rows = all;
      setTargetHistory(all);
    } catch (e) {
      dbg("target history FAILED: " + e.message);
      setSaveError("target change saved, but its history wasn't recorded — " + e.message);
    }
  };

  // Load target history once data is loaded; any preset with no history yet
  // gets a baseline row with its current values (tracking starts now).
  // Once per signed-in user: a token refresh hands over a new session object
  // and re-runs this effect, and two overlapping runs would both write the
  // baseline.
  const historyLoadForRef = useRef(null);
  useEffect(() => {
    if (!loaded || !session || !store) return;
    if (historyLoadForRef.current === session.user.id) return;
    const uid = session.user.id;
    historyLoadForRef.current = uid;
    (async () => {
      try {
        let rows = await sbLoadTargetHistory(session);
        const missing = (store.phases || []).filter((p) => !rows.some((r) => r.preset_id === p.id));
        if (missing.length) {
          const base = missing.map((p) => historyRow(p, BASELINE_DATE));
          await sbUpsertTargetHistory(session, base);
          rows = [...base, ...rows];
        }
        // not tied to this effect's cleanup: a token refresh re-runs the effect,
        // and the guard above skips that re-run, so this result must land
        if (historyLoadForRef.current === uid) { historyRef.current = { loaded: true, rows }; setTargetHistory(rows); setHistoryReady(true); }
      } catch (e) {
        historyLoadForRef.current = null; // let a later run retry
        dbg("target history load FAILED: " + e.message); // past days fall back to current targets
      }
    })();
  }, [loaded, session]);

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
    clearSignedInState();
  };

  // Drop the session and every piece of loaded state, without saving.
  const clearSignedInState = () => {
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
    setTargetHistory([]);
    historyRef.current = { loaded: false, rows: [] };
    historyLoadForRef.current = null;
    setRangeIntake({});
    setDayStatus({});
    setCheckins([]);
    setCheckinsLoaded(false);
    setBwLoaded(false);
    setHistoryReady(false);
    // the next account must not inherit this one's training status or its
    // answer to the strength suggestion
    setTraining(null);
    setStrengthAnswer(null);
  };

  const handleAccountDeleted = () => {
    clearSignedInState();
    window.alert("Your account and all of its data have been deleted.");
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
  const foods  = store ? store.foods  : [];
  const phases = store ? store.phases : SEED_PHASES;
  const planStore = store ? store.week : null; // every week's plan (v2)
  const planMonday = mondayOf(selectedDate);
  const planFoodsKept = planStore ? planKeepsFoods(planStore, planMonday, todayISO()) : true;
  // the selected week's plan (a week too old to keep foods shows without them)
  const week = planStore ? (planFoodsKept ? planFor(planStore, planMonday) : stripFoods(planFor(planStore, planMonday))) : null;
  const todayWeek = planStore ? planFor(planStore, mondayOf(todayISO())) : null; // the phase card's week

  const setFoods  = (val) => setStore((s) => ({ ...s, foods:  typeof val === "function" ? val(s.foods)  : val }));
  const setPhases = (val) => setStore((s) => ({ ...s, phases: typeof val === "function" ? val(s.phases) : val }));
  // edits the selected week's plan (saving it if it was still the empty default)
  const setWeek   = (val) => setStore((s) => {
    const today = todayISO(), cur = mondayOf(today);
    let base = s.week;
    // an edit to another week mustn't reshape this week while it's still the
    // empty default borrowed from it, so this week is saved as it looks now
    if (planMonday !== cur && !base.plans[cur]) base = { ...base, plans: { ...base.plans, [cur]: planFor(base, cur) } };
    // weeks before the first saved week borrow its meals, so before that week
    // changes, the week before it keeps how it looked (meals and targets)
    const first = Object.keys(base.plans).sort()[0];
    const prior = addDaysISO(planMonday, -7);
    if (planMonday <= first && !base.plans[prior]) base = { ...base, plans: { ...base.plans, [prior]: stripFoods(planFor(base, planMonday)) } };
    const next = typeof val === "function" ? val(planFor(base, planMonday)) : val;
    return { ...s, week: withPlan(base, planMonday, next, today) };
  });
  const setPlanStore = (val) => setStore((s) => ({ ...s, week: typeof val === "function" ? val(s.week) : val }));

  // load — from Supabase, once session is available
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      setLoadError(false);
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
          // an account's own list, even an empty one — new accounts start with no foods
          const loadedFoods = Array.isArray(row.foods) ? row.foods : [];

          // migrate phase ids to stable
          let loadedPhases = (row.phases && row.phases.length) ? row.phases : SEED_PHASES;
          const idRemap = {};
          loadedPhases = loadedPhases.map((p) => {
            const stableId = nameToStableId[p.name];
            if (stableId && p.id !== stableId) { idRemap[p.id] = stableId; p = { ...p, id: stableId }; }
            // Accounts seeded before presets carried a phase_type have none, so
            // the diet-phase picker showed no options. Fill in the seed's type.
            if (!p.phase_type && SEED_PHASE_TYPES[p.id]) p = { ...p, phase_type: SEED_PHASE_TYPES[p.id] };
            // The refeed preset was seeded as a deficit, so it could be picked as a
            // diet phase and read as a cut. It's a day override; saved with the next edit.
            if (p.id === "phase-weekend" && p.phase_type === "deficit") p = { ...p, phase_type: "day" };
            return p;
          });

          // every week's plan; the old single template becomes last week's (see loadPlanStore)
          const loadedWeek = loadPlanStore(row.week, todayISO(), idRemap);

          const loadedStore = { foods: loadedFoods, phases: loadedPhases, week: loadedWeek };
          // baseline = what was loaded, so opening the app doesn't re-save it.
          // (Seed fallbacks / the id migration above save with the next real edit.)
          savedRef.current = { updatedAt: row.updated_at, json: JSON.stringify(loadedStore) };
          setStore(loadedStore);
        } else {
          // new user (query SUCCEEDED, returned no row) — seed defaults, saved on first change.
          // A row with no foods still exists, so its updated_at is the base to save over.
          // New accounts start with an empty food list (starter foods were burying people's own).
          const seeded = { foods: [], phases: SEED_PHASES, week: loadPlanStore(null, todayISO()) };
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
  // Keyed on WHO is signed in, not the session object: a token refresh swaps
  // the object every hour, and re-running the full load on each refresh could
  // replace an edit that hasn't saved yet.
  }, [session?.user?.id, reloadNonce]);

  // Coming back to the app. A home-screen app on iOS isn't reloaded when it's
  // reopened — it resumes, sometimes days later — so the launch-time token
  // refresh and data load go stale: the token expires after ~1 hour (every
  // save then fails) and edits made on another device never show up. On
  // returning to the foreground, and every few minutes while open:
  //   1. refresh the token if it's about to expire
  //   2. if the saved data changed elsewhere, reload it — silently when
  //      nothing here is unsaved, otherwise via the existing conflict banner
  const latestRef = useRef({});
  latestRef.current = { session, store, loaded, loadError, saveConflict };
  const refreshingRef = useRef(null);
  useEffect(() => {
    if (!session?.user?.id) return;
    let cancelled = false;

    const freshSession = async () => {
      const current = latestRef.current.session;
      if (!current || !tokenExpiringSoon(current.access_token)) return current;
      if (!refreshingRef.current) {
        // one refresh at a time — refresh tokens are single-use
        refreshingRef.current = sbRefreshToken(current.refresh_token)
          .then((r) => {
            const next = { access_token: r.access_token, refresh_token: r.refresh_token, user: r.user || current.user };
            try { localStorage.setItem(SESSION_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
            if (!cancelled) setSession(next);
            return next;
          })
          .catch((e) => { dbg("token refresh FAILED: " + e.message); return current; })
          .finally(() => { refreshingRef.current = null; });
      }
      return refreshingRef.current;
    };

    const syncFromServer = async (sess) => {
      const { store: st, loaded: ld, loadError: le, saveConflict: sc } = latestRef.current;
      if (!ld || le || sc || !st) return;
      let row;
      try { row = await sbLoadAppData(sess); } catch { return; } // offline etc. — try again next time
      if (cancelled || !row || row.updated_at === savedRef.current.updatedAt) return;
      const unsaved = JSON.stringify(latestRef.current.store) !== savedRef.current.json;
      dbg("data changed on another device — " + (unsaved ? "conflict" : "reloading"));
      if (unsaved) setSaveConflict(true);
      else {
        setIntake({}); // re-read the food log too
        setReloadNonce((n) => n + 1);
      }
    };

    const onForeground = async () => {
      if (document.visibilityState !== "visible") return;
      const sess = await freshSession();
      if (!cancelled && sess) await syncFromServer(sess);
    };

    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("pageshow", onForeground);
    const timer = setInterval(() => { freshSession(); }, 4 * 60 * 1000);
    freshSession();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("pageshow", onForeground);
      clearInterval(timer);
    };
  }, [session?.user?.id]);

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
      const [phases, weights, trainingStatus] = await Promise.allSettled([
        sbLoadDietPhases(session),
        sbLoadRecentBodyweight(session),
        sbLoadTrainingStatus(session),
      ]);
      if (cancelled) return;
      // optional context, so a failure only goes to the debug log
      if (trainingStatus.status === "fulfilled") setTraining(trainingStatus.value);
      else dbg("training status load FAILED: " + trainingStatus.reason?.message);
      const failed = [];
      if (phases.status === "fulfilled") {
        let rows = phases.value;
        // a cut, mini-cut or bulk past its planned end with nothing after it
        // switches to maintenance (owner's call, Nov 2026)
        try {
          if (await sbEndOverrunningPhase(session, rows, storeRef.current?.phases || [])) rows = await sbLoadDietPhases(session);
        } catch (e) { dbg("overrun switch FAILED: " + e.message); }
        if (cancelled) return;
        setDietPhases(rows);
        setDietLoaded(true);
      }
      else { failed.push("diet phases"); dbg("diet phase load FAILED: " + phases.reason?.message); }
      if (weights.status === "fulfilled") {
        dailyCheckDayRef.current = day;
        setBwLog(weights.value);
        setBwLoaded(true);
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

  const reloadDietPhases = async () => { const rows = await sbLoadDietPhases(session); setDietPhases(rows); return rows; };

  // The phase in effect today changed pace (calendar or Phases): its target's
  // calories move by what the new pace needs (shiftForRate); carbs take it,
  // fat up to its minimum. `target` overrides that with macros already chosen.
  const applyActiveRate = (row, oldRate, newRate, target = null) => {
    const weightLb = coaching?.weightLb ?? null;
    setPhases((prev) => prev.map((p) => {
      if (p.id !== row.phase_id) return p;
      let t = target;
      if (!t) {
        if (!weightLb) return p; // no weight: the pace's calories can't be worked out, target kept
        const f = fitMacros(p.target, shiftForRate(p.target, oldRate, newRate, weightLb), { clampCarbs: true });
        t = { p: f.p, f: f.f, c: f.c, cal: f.cal };
      }
      if (sameTarget(t, p.target)) return p;
      return { ...p, target: t, example: false, fit: { date: todayISO(), reason: "rate", ratePct: roundRate(newRate), fromRatePct: roundRate(oldRate), weightLb: weightLb ? r1(weightLb) : null, estimate: coaching?.basis ? Math.round(coaching.basis.kcal) : null, source: coaching?.basis?.source || null, from: { ...p.target } } };
    }));
  };

  // Onboarding: decided once the data is in. An account that already has
  // real targets or a diet phase has been using the app: it skips it all.
  useEffect(() => {
    if (ob || !loaded || !store || !dietLoaded || !session) return;
    const saved = session.user?.user_metadata?.mealprep_onboarding;
    if (saved) { obRef.current = saved; setOb(saved); return; }
    const hasHistory = (store.phases || []).some((p) => !p.example) || dietPhases.length > 0;
    saveOb(hasHistory ? ONBOARDING_ALL_SEEN : { v: 1, tour: false, setup: false, tips: {}, banners: {} });
  }, [ob, loaded, store, dietLoaded, session, dietPhases]);
  // setup picks up where it left off (tour seen, setup not finished)
  useEffect(() => { if (ob && ob.tour && !ob.setup && !setup) setSetup({ step: "phase" }); }, [ob, setup]);
  const finishTour = () => { saveOb({ ...obRef.current, tour: true }); if (!obRef.current.setup) setSetup({ step: "phase" }); };
  // setup step 3 saves the targets, then starts the phase they picked from today
  const applySetup = async (targets, profile) => {
    await applyCalc(targets, profile);
    try {
      const preset = presetForType(phases, setup.type);
      if (preset) { await sbSwitchDietPhase(session, preset, dietPhases, phases); await reloadDietPhases(); }
      if (setup.type === "deficit") cutStartedRef.current = true;
    } catch (e) { dbg("setup phase FAILED: " + e.message); window.alert("Couldn't start your phase — " + e.message); }
    setSetup({ ...setup, step: "next", weight: profile.weight_lb });
  };
  const finishSetup = () => { saveOb({ ...obRef.current, setup: true }); setSetup(null); };

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
      const before = phaseOnDate(dietPhases, todayISO());
      await write(session);
      const rows = await reloadDietPhases();
      // today's phase given a new pace (same phase, same preset): its calories follow
      const after = phaseOnDate(rows, todayISO());
      if (before && after && after.id === before.id && after.phase_id === before.phase_id && after.phase_type !== "maintenance"
        && Math.abs(phaseRatePct(after) - phaseRatePct(before)) > EPS) {
        applyActiveRate(after, phaseRatePct(before), phaseRatePct(after));
      }
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

  /* ---------- weekly check-in data ----------
     The last 5 weeks of logged calories (by date), which days count, and
     past check-ins — loaded once signed in; the estimate and suggestion are
     computed from them on every render, so they always match the log. */
  const [rangeIntake, setRangeIntake] = useState({}); // { iso: kcal } from the server
  const [rangeProtein, setRangeProtein] = useState(null); // { iso: grams | null (a food's protein unknown) }; null until loaded
  const [dayStatus, setDayStatus] = useState({});     // { iso: included } — explicit choices only
  const [checkins, setCheckins] = useState([]);
  const [checkinsLoaded, setCheckinsLoaded] = useState(false);
  const [coachError, setCoachError] = useState(null);
  useEffect(() => {
    if (!loaded || !session) return;
    let cancelled = false;
    (async () => {
      try {
        const from = addDaysISO(todayISO(), -35);
        const [rows, status, cks] = await Promise.all([
          sbLoadIntakeRange(session, from, todayISO()),
          sbLoadDayStatus(session, from),
          sbLoadCheckins(session),
        ]);
        if (cancelled) return;
        const byDate = {};
        const protein = {};
        for (const r of rows) {
          byDate[r.date] = (byDate[r.date] || 0) + Number(r.qty) * Number(r.cal);
          const g = r.p == null ? null : Number(r.qty) * Number(r.p);
          protein[r.date] = (r.date in protein && protein[r.date] === null) || g === null ? null : (protein[r.date] || 0) + g;
        }
        setRangeIntake(byDate);
        setRangeProtein(protein);
        setDayStatus(Object.fromEntries(status.map((s) => [s.date, s.included])));
        setCheckins(cks);
        setCheckinsLoaded(true);
        setCoachError(null);
      } catch (e) {
        dbg("check-in data load FAILED: " + e.message);
        setCoachError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [loaded, session]);

  const coaching = useMemo(() => {
    if (!store) return null;
    const today = todayISO();
    const weekStart = mondayOf(today);
    // logged calories by date: what's on screen for dates already opened, else the range load
    const intakeByDate = { ...rangeIntake };
    for (const [d, rows] of Object.entries(intake)) intakeByDate[d] = intakeTotal(rows).cal;
    const followed = dietPhase ? (store.phases || []).find((p) => p.id === dietPhase.phase_id) || null : null;
    const maint = maintenancePreset(store.phases);
    // a day logged at under half its target looks partial: left out unless you tick it
    const statusByDate = { ...dayStatus };
    const halfTarget = (followed?.target.cal || maint?.target.cal || 0) / 2;
    for (const [d, kcal] of Object.entries(intakeByDate)) {
      if (!(d in statusByDate) && kcal > 0 && kcal < halfTarget) statusByDate[d] = false;
    }
    const sorted = [...checkins].sort((a, b) => (a.week_start < b.week_start ? -1 : 1));
    const thisWeek = sorted.find((c) => c.week_start === weekStart) || null;
    const last = [...sorted].reverse().find((c) => c.week_start < weekStart) || null;
    const startingGuess = maint && !maint.example ? Number(maint.target.cal) || null : null;
    const prior = last ? Number(last.estimate) : startingGuess;
    const raw = rawMaintenance({ log: bwLog, intakeByDate, statusByDate, today });
    // no starting guess (example targets): the first real estimate stands as is
    // first data-based estimate replacing a starting guess: a bigger step (EST_FIRST_STEP);
    // otherwise faster when last week's data pointed the same way (EST_STEP_AGREE)
    const firstData = prior != null && raw.raw != null && !sorted.some((c) => c.week_start < weekStart && c.estimate_raw != null);
    const agrees = !firstData && estimateAgrees(last, prior, raw.raw);
    const estimate = prior != null ? nextEstimate(prior, raw.raw, firstData ? "first" : agrees ? "agree" : null) : raw.raw;
    const latest = (bwLog || []).length ? Number(bwLog[bwLog.length - 1].weight) : null;
    const weightLb = raw.trendWeight ?? latest;
    const wk = weightTrend(bwLog, today);
    // maintenance: 0, or the pace that wins back a drift (maintenanceHold)
    const hold = dietPhase?.phase_type === "maintenance" ? maintenanceHold(dietPhase, dietPhases, bwLog, today, sorted, followed?.holdFrom || null) : null;
    const ratePct = !dietPhase ? 0 : hold ? hold.ratePct : phaseRatePct(dietPhase);
    // suggest new targets only once the estimate rests on your own log and
    // weigh-ins (this week's, or an earlier check-in's), never on a guess
    const grounded = raw.raw != null || sorted.some((c) => c.estimate_raw != null);
    const suggestion = followed && estimate != null && grounded
      ? suggestTargets({ estimate, ratePctPerWeek: ratePct, weightLb, current: followed.target, phaseType: dietPhase.phase_type, maxChange: checkinMaxChange(dietPhase.phase_type, firstData) })
      : null;
    // shown on the phase card: the latest check-in's estimate, else the starting guess
    const shown = thisWeek || last;
    return {
      today, weekStart, firstData, intakeByDate, statusByDate, raw, estimate, prior, agrees, startingGuess, weightLb, ratePct, grounded, hold,
      // the estimate the saved targets rest on (recorded, never this week's unapplied one)
      basis: estimateBasis({ checkins: sorted, maintenance: maint }),
      actualPct: wk.ready ? wk.pctPerWeek : null, followed, suggestion, thisWeek, last,
      // nothing to check in on until there's an estimate (example targets, no data yet)
      // not until there's a logged day before today: a brand-new account's
      // first check-in would have nothing to tick (owner's call, Nov 2026)
      due: !!dietPhase && !!followed && !thisWeek && estimate != null && Object.entries(intakeByDate).some(([d, k]) => d < today && k > 0),
      card: shown ? { kcal: Number(shown.estimate), estimated: shown.estimate_raw != null || sorted.some((c) => c.estimate_raw != null) } : startingGuess ? { kcal: startingGuess, estimated: false } : null,
    };
  }, [store, rangeIntake, intake, dayStatus, checkins, bwLog, dietPhase, dietPhases]);

  /* ---------- protein summary for RepReport ----------
     The 7 days ending yesterday (today is still being logged): the average
     protein over the days that count toward the estimate, and the average of
     those days' protein targets (the diet phase's preset as it was that day,
     or the weekday's override). A day with a calories-only quick add has no
     protein total, so it's left out. RepReport shows it, and adds it to its
     lifts-down note when under 80% of target; it never changes training. */
  const proteinStatus = useMemo(() => {
    if (!coaching || !store || rangeProtein == null) return null;
    const proteinByDate = { ...rangeProtein };
    for (const [d, rows] of Object.entries(intake)) proteinByDate[d] = dayProtein(rows);
    return buildProteinStatus({
      today: coaching.today, intakeByDate: coaching.intakeByDate, statusByDate: coaching.statusByDate, proteinByDate,
      presets: store.phases || [], targetHistory, dietPhases, planStore: store.week,
    });
  }, [coaching, store, rangeProtein, intake, targetHistory, dietPhases]);
  const savedStatusRef = useRef(null);
  useEffect(() => {
    if (!session || !proteinStatus) return;
    const json = JSON.stringify(proteinStatus);
    if (json === savedStatusRef.current) return;
    savedStatusRef.current = json;
    sbSaveStatus(session, proteinStatus).catch((e) => { savedStatusRef.current = null; dbg("status save FAILED: " + e.message); });
  }, [session, proteinStatus]);

  // tick / untick a day for the estimate (also used by the Plan day row)
  const setDayIncluded = async (date, included) => {
    setDayStatus((m) => ({ ...m, [date]: included }));
    try { await sbSetDayStatus(session, date, included); }
    catch (e) { dbg("day status FAILED: " + e.message); window.alert("Couldn't save that — " + e.message); }
  };

  // Record this week's check-in; Apply/Adjust also update the phase's targets
  // (target history keeps the old values for past days).
  const completeCheckin = async (requested, chosen) => {
    const c = coaching;
    if (!c || !c.followed) return false;
    const before = { ...c.followed.target };
    // Adjust: the calories you chose become the estimate (less what the
    // phase's pace adds), so next week starts from your number instead of
    // pulling you back toward the old one. (Owner's choice, Oct 2026)
    // An Edit that only changes the split is a Use (see checkinOutcome).
    const date = todayISO();
    const { action, estimate } = checkinOutcome({ action: requested, chosen, c, presets: store.phases || [], date });
    try {
      await sbInsertCheckin(session, {
        week_start: c.weekStart, estimate: Math.round(estimate), estimate_raw: c.raw.raw == null ? null : Math.round(c.raw.raw),
        included_days: c.raw.includedDays, weigh_in_days: c.raw.weighInDays,
        actual_rate_pct: c.actualPct == null ? null : roundRate(c.actualPct), target_rate_pct: roundRate(c.ratePct),
        preset_id: c.followed.id, before,
        suggested: c.suggestion ? { p: c.suggestion.p, f: c.suggestion.f, c: c.suggestion.c, cal: c.suggestion.cal } : null,
        chosen: action === "keep" ? null : chosen, action,
      });
    } catch (e) {
      dbg("check-in save FAILED: " + e.message);
      window.alert("Couldn't save the check-in — " + e.message);
      return false;
    }
    // Use/Edit set the phase's target; Keep leaves it. Presets not in effect
    // follow the new estimate either way (once it rests on your data).
    setPhases((prev) => checkinOutcome({ action: requested, chosen, c, presets: prev, date }).presets);
    setCheckins((prev) => [...prev, {
      week_start: c.weekStart, estimate: Math.round(estimate), estimate_raw: c.raw.raw == null ? null : Math.round(c.raw.raw), action,
      chosen: action === "keep" ? null : chosen, before, target_rate_pct: roundRate(c.ratePct), preset_id: c.followed.id,
    }]);
    return true;
  };

  /* ---------- maintenance check-ins apply themselves ----------
     At maintenance, once the estimate rests on your data, the week's
     check-in is completed for you with its suggestion (marked auto), and
     Plan shows what changed with Undo. Cuts and bulks still ask. (Owner's
     choice, Nov 2026: a Keep or a skipped check-in let maintenance drift.) */
  const autoCheckinRef = useRef(null);
  useEffect(() => {
    const c = coaching;
    if (!c || !c.due || !c.suggestion || !c.grounded || dietPhase?.phase_type !== "maintenance") return;
    if (!checkinsLoaded || !dietLoaded || !bwLoaded || !historyReady || loadError) return;
    if (autoCheckinRef.current === c.weekStart) return;
    // a catch-up's first week is explained and confirmed first (CatchUpProposal)
    if (catchUpStarting(c.hold)) return;
    autoCheckinRef.current = c.weekStart;
    const s = c.suggestion;
    completeCheckin("apply", { p: s.p, f: s.f, c: s.c, cal: s.cal, auto: true });
  }, [coaching, dietPhase, checkinsLoaded, dietLoaded, bwLoaded, historyReady, loadError]);

  // The first week of a catch-up, from its explanation: OK applies it (as an
  // automatic check-in); "Hold … instead" makes today's weight the one to hold,
  // and the check-in then applies itself at plain maintenance.
  const acceptCatchUp = async () => {
    const s = coaching?.suggestion;
    if (!s) return;
    autoCheckinRef.current = coaching.weekStart;
    await completeCheckin("apply", { p: s.p, f: s.f, c: s.c, cal: s.cal, auto: true });
  };
  const holdCurrentWeight = () => {
    if (!dietPhase) return;
    setPhases((prev) => prev.map((p) => (p.id === dietPhase.phase_id ? { ...p, holdFrom: { rowId: dietPhase.id, date: todayISO() } } : p)));
  };

  // "Something off?" on an automatic maintenance check-in: each reason's fix
  // (resolveCheckinReason). The target goes back only if you haven't changed it since.
  const [reviewDays, setReviewDays] = useState(false);
  const resolveAutoCheckin = async (reason, { half = false } = {}) => {
    const ck = coaching?.thisWeek;
    if (!ck?.chosen?.auto || !dietPhase) return false;
    const r = resolveCheckinReason(reason, { ck, row: dietPhase, weightLb: coaching.weightLb, today: todayISO(), half });
    if (!r) return false;
    try {
      if (r.remove) await sbDeleteCheckin(session, ck.week_start);
      else await sbUpdateCheckin(session, ck.week_start, r.patch);
      if (r.start) {
        const preset = presetForType(phases, r.start.type);
        if (preset) { await sbSwitchDietPhase(session, { ...preset, rate_pct: r.start.ratePct }, dietPhases, phases); await reloadDietPhases(); }
      }
    } catch (e) {
      dbg("check-in change FAILED: " + e.message);
      window.alert("Couldn't save that — " + e.message);
      return false;
    }
    setPhases((prev) => prev.map((p) => {
      if (p.id !== ck.preset_id) return p;
      let next = p;
      if (sameTarget(p.target, ck.chosen) && !sameTarget(r.target, p.target)) next = { ...next, target: { ...r.target }, fit: { date: todayISO(), reason: "checkin", from: { ...p.target } } };
      if (r.holdFrom) next = { ...next, holdFrom: r.holdFrom };
      return next;
    }));
    setCheckins((prev) => (r.remove ? prev.filter((x) => x.week_start !== ck.week_start) : prev.map((x) => (x.week_start === ck.week_start ? { ...x, ...r.patch } : x))));
    if (r.reviewDays) setReviewDays(true);
    return true;
  };

  /* ---------- a phase's fresh target when it starts ----------
     When a phase comes into effect (switched to, a planned start date
     arriving, or maintenance after a cut), its preset is recalculated from
     the recorded estimate and that phase's own rate (phaseStartUpdate). Waits
     until everything it reads has loaded, so it never works from a partial
     picture, and runs once per phase (startedFor). */
  useEffect(() => {
    if (!loaded || !store || !dietLoaded || !checkinsLoaded || !bwLoaded || !historyReady || loadError) return;
    const row = phaseOnDate(dietPhases, todayISO());
    const basis = coaching?.basis || null;
    const next = phaseStartUpdate(store.phases || [], { row, estimate: basis?.kcal ?? null, weightLb: coaching?.weightLb ?? null, date: todayISO(), source: basis?.source || null });
    if (next !== store.phases) setPhases((prev) => (prev === store.phases ? next : prev));
  }, [loaded, store, dietLoaded, checkinsLoaded, bwLoaded, historyReady, loadError, dietPhases, coaching]);

  // Getting back on plan (BehindPlan): the plan line restarts from today; "later"
  // also moves the phase's end (and the maintenance after it, as a calendar edit
  // does), "faster" its rate (calories follow, see editDietPhases).
  const replan = async (kind, arg) => {
    const row = phaseOnDate(dietPhases, todayISO());
    if (!row) return;
    let ok = true;
    if (kind === "later") {
      ok = await editDietPhases(async (sess) => {
        let rows = dietPhases;
        const old = followingMaintenance(dietPhases, row);
        if (old) { await sbDeleteDietPhase(sess, old.id); rows = rows.filter((r) => r.id !== old.id); }
        await sbUpdateDietPhase(sess, row.id, { planned_end_date: arg });
        await sbAddMaintenanceAfter(sess, rows, { ...row, planned_end_date: arg }, store.phases || []);
      });
    } else if (kind === "faster") {
      ok = await editDietPhases((sess) => sbUpdateDietPhase(sess, row.id, { target_rate_pct: roundRate(arg) }));
    }
    if (ok) setPhases((prev) => prev.map((p) => (p.id === row.phase_id ? { ...p, planFrom: { rowId: row.id, date: todayISO() } } : p)));
  };

  // Phases tab saves. A preset not in effect: its target and default rate.
  // The phase in effect: its own rate goes on its diet_phases row (what
  // RepReport reads), and the target saved from today (target history keeps
  // the old one for past days). Calories only change through the rate.
  const savePresetTarget = (presetId, { target, ratePct = null, cal = null }) => {
    setPhases((prev) => prev.map((p) => {
      if (p.id !== presetId) return p;
      const next = { ...p, target: { p: target.p, f: target.f, c: target.c, cal: cal ?? target.cal }, example: false };
      if (ratePct != null) next.rate_pct = roundRate(ratePct);
      if (!sameTarget(next.target, p.target)) next.fit = { date: todayISO(), reason: "edit", from: { ...p.target }, ratePct: ratePct != null ? roundRate(ratePct) : null };
      return next;
    }));
  };
  const saveActiveTarget = async ({ target, ratePct, alsoDefault = false }) => {
    const row = phaseOnDate(dietPhases, todayISO());
    if (!row) return false;
    const oldRate = phaseRatePct(row);
    if (ratePct != null && Math.abs(ratePct - oldRate) > EPS) {
      try {
        await sbUpdateDietPhase(session, row.id, { target_rate_pct: roundRate(ratePct) });
        await reloadDietPhases();
      } catch (e) {
        dbg("phase rate save FAILED: " + e.message);
        window.alert("Couldn't save the phase's rate — " + e.message);
        return false;
      }
      applyActiveRate(row, oldRate, ratePct, target);
    } else {
      setPhases((prev) => prev.map((p) => (p.id === row.phase_id && !sameTarget(target, p.target)
        ? { ...p, target: { ...target }, example: false, fit: { date: todayISO(), reason: "edit", from: { ...p.target }, ratePct: roundRate(oldRate) } } : p)));
    }
    if (alsoDefault && ratePct != null) setPhases((prev) => prev.map((p) => (p.id === row.phase_id ? { ...p, rate_pct: roundRate(ratePct) } : p)));
    return true;
  };

  // Your answer to RepReport's strength suggestion ("keep" or "slow"), kept
  // on the account so it quiets the suggestion on every device (see
  // strengthView). This session's answer, else the saved one.
  const strengthChoice = strengthAnswer || session?.user?.user_metadata?.strength_choice || null;
  const rememberStrengthChoice = async (action, changePct) => {
    const choice = { date: todayISO(), action, changePct: changePct ?? null };
    setStrengthAnswer(choice);
    // not via setSession, which would re-run the data loads (as in applyCalc)
    try {
      const next = await sbUpdateUserMeta(session, { strength_choice: choice });
      localStorage.setItem(SESSION_KEY, JSON.stringify({ access_token: next.access_token, refresh_token: next.refresh_token, user: next.user }));
    } catch (e) { dbg("strength choice save FAILED: " + e.message); }
  };
  // Slow the cut to 0.5%/week in one step: the phase's target pace, and the
  // followed target's calories raised by deltaKcal (carbs take it, protein
  // and fat floors as usual). The check-ins carry on from the new numbers.
  const slowCut = async (deltaKcal, changePct) => {
    const followed = coaching?.followed;
    if (!dietPhase || !followed) return;
    // today's row and any later rows of the same cut block (a planned
    // continuation of the cut keeps the slower pace too)
    const kind = phaseKind(dietPhase);
    const sorted = [...dietPhases].sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
    const rows = [];
    for (let i = sorted.findIndex((r) => r.id === dietPhase.id); i >= 0 && i < sorted.length && phaseKind(sorted[i]) === kind; i++) rows.push(sorted[i]);
    try {
      for (const r of rows) await sbUpdateDietPhase(session, r.id, { target_rate_pct: STRENGTH_SLOW_TO_PCT });
    } catch (e) {
      dbg("slow cut FAILED: " + e.message);
      window.alert("Couldn't change the cut's pace — " + e.message);
      return;
    }
    const cal = Math.round((Number(followed.target.cal) + deltaKcal) / 10) * 10;
    const t = splitMacros({ cal, current: followed.target, phaseType: "deficit", weightLb: coaching.weightLb });
    const fromRatePct = phaseRatePct(dietPhase);
    setPhases((prev) => prev.map((p) => (p.id === followed.id ? { ...p, target: { p: t.p, f: t.f, c: t.c, cal: t.cal }, example: false,
      fit: { date: todayISO(), reason: "rate", ratePct: STRENGTH_SLOW_TO_PCT, fromRatePct: roundRate(fromRatePct), weightLb: coaching.weightLb ? r1(coaching.weightLb) : null, from: { ...p.target } } } : p)));
    try { await reloadDietPhases(); } catch (e) { dbg("diet phase reload FAILED: " + e.message); }
    await rememberStrengthChoice("slow", changePct);
  };

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

  // shown once per account (and again whenever TERMS_VERSION changes),
  // including accounts created before this gate existed. Data may load
  // behind it, but the app doesn't render, so nothing is edited or saved.
  if (!hasConsent(session.user)) {
    return <ConsentScreen session={session} onConfirmed={handleAuthed} onSignOut={signOut} />;
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

  /* ---------- onboarding: what shows today (after setup) ---------- */
  const obReady = !!ob?.setup;
  const todayIso = todayISO();
  const pace = obReady ? paceReading(dietPhases, bwLog, todayIso) : { ready: false };
  const planDone = obReady ? planDoneInfo(dietPhases, todayIso) : null;
  const showWhatsNext = !!planDone && !whatsNextLater && ob?.dismissed?.whatsNext !== planDone.key;
  const baselineNote = showWhatsNext && planDone.kind === "plan" && training && (planDone.prevType === "deficit" || planDone.prevType === "surplus")
    && Math.round(volumeImpactPct(dietPhaseContext(dietPhases, todayIso, bwLog))) === 0
    ? `Your training is back to baseline: the most sets each muscle can get is back to normal after your ${planDone.prevType === "deficit" ? "cut" : "bulk"}.`
    : null;
  const pickNext = async (type) => {
    if (type !== "maintenance") {
      const preset = presetForType(phases, type);
      if (preset) {
        try { await sbSwitchDietPhase(session, preset, dietPhases, phases); await reloadDietPhases(); }
        catch (e) { window.alert("Couldn't start it — " + e.message); return; }
        if (type === "deficit") cutStartedRef.current = true;
      }
    }
    saveOb({ ...obRef.current, dismissed: { ...(obRef.current?.dismissed || {}), whatsNext: planDone.key } });
  };
  // an open-ended maintenance or bulk running 8+ weeks with nothing planned after
  const nudge = (() => {
    if (!obReady || showWhatsNext || ob?.dismissed?.nudge || !dietPhase || dietPhase.phase_type === "deficit" || dietPhase.planned_end_date) return false;
    if (dietPhases.some((r) => r.start_date > todayIso)) return false;
    return daysBetween(dietPhase.start_date, todayIso) >= 56;
  })();
  const dismissNudge = () => saveOb({ ...obRef.current, dismissed: { ...(obRef.current?.dismissed || {}), nudge: true } });
  const checkinTipDue = obReady && !!coaching?.due && !ob.tips?.checkin;
  const maintBanner = obReady && !!coaching?.due && coaching.firstData && !!coaching.suggestion && !!ob.tips?.checkin && !ob.banners?.maintenance;
  const paceBanner = obReady && pace.ready && !ob.banners?.pace && !maintBanner;
  const cutTipDue = obReady && !checkinTipDue && dietPhase?.phase_type === "deficit" && !ob.tips?.cut && !cutStartedRef.current;
  const topCards = obReady ? (
    <>
      {showWhatsNext && <WhatsNextCard info={planDone} baselineNote={baselineNote} onPick={pickNext} onLater={() => setWhatsNextLater(true)} />}
      {maintBanner && (
        <UnlockedBanner title="Your real maintenance is in" dots={coaching.raw?.includedDays || 0}
          sub={`${coaching.raw?.includedDays || 0} fully logged days and ${coaching.raw?.weighInDays || 0} weigh-ins. Meal Prep now sets your targets from what you actually burn, not a formula.`}
          onSee={() => { markOb(["banners", "maintenance"]); setTipOpen("firstTargets"); }}
          onClose={() => markOb(["banners", "maintenance"], ["tips", "firstTargets"])} />
      )}
      {paceBanner && (
        <UnlockedBanner title="Your pace is in" dots={pace.weighIns}
          sub={`${pace.weighIns} weigh-ins over two weeks. That's enough for Meal Prep to read your real trend, not just one morning.`}
          onSee={() => { markOb(["banners", "pace"]); setTipOpen("pace"); }}
          onClose={() => markOb(["banners", "pace"], ["tips", "pace"])} />
      )}
    </>
  ) : null;
  const followedNow = dietPhase ? phases.find((p) => p.id === dietPhase.phase_id) || null : null;
  const laterTip = !obReady ? null
    : checkinTipDue ? (
      <TipCard title="A quick check-in: tick the days you fully logged" caption="Saturday was half-logged, so it's left out."
        body="Once a week, tick the days you logged everything you ate. Meal Prep learns your maintenance from those days, so untick any day you missed a meal. Your first suggested targets come in 2–3 weeks."
        onDone={() => markOb(["tips", "checkin"])}><CheckinTicksDemo /></TipCard>
    ) : cutTipDue && followedNow ? (
      <TipCard title="Your cut" caption="Your cut on day 1, for your weight."
        body={`Protein rises to 0.9 g/lb. Meal Prep warns you if your cut would lose more than 1% of your bodyweight per week (${coaching?.weightLb ? `${(coaching.weightLb / 100).toFixed(1)} lb at ${Math.round(coaching.weightLb)} lb` : "1.8 lb at 180 lb"}), the top of the range for keeping muscle.${training?.active ? " RepReport now plans your sets around this cut, and the Strength section shows how your lifts hold up." : ""}`}
        onDone={() => markOb(["tips", "cut"])}>
        <CutSummary cut={followedNow} maint={maintenancePreset(phases)} ratePct={phaseRatePct(dietPhase)} training={training} />
      </TipCard>
    ) : tipOpen === "pace" && pace.ready ? (
      <TipCard title="Your pace, from your weigh-ins"
        body={`${paceSentence(pace.phase.phase_type, pace.pctPerWeek, pace.avg, phaseRatePct(pace.phase))} Keep weighing in most mornings to keep it accurate.`}
        onDone={() => { markOb(["tips", "pace"]); setTipOpen(null); }}>
        <PhaseCard dietPhases={dietPhases} bwLog={bwLog} onOpenMonth={() => {}} presets={phases} week={todayWeek} estimate={coaching?.card}
          trainingActive={training?.active} hasRepReport={!!training} deload={false} strength={null} strengthChoice={null} weightLb={coaching?.weightLb ?? null}
          canSlow={false} onSlowCut={() => {}} onKeepStrength={() => {}} trainingGoal={null} />
      </TipCard>
    ) : tipOpen === "firstTargets" && coaching?.suggestion ? (
      <TipCard title="Your real maintenance, and your first suggested targets" caption="The first check-in with enough of your data."
        body="Meal Prep now estimates your maintenance from your own logs and weigh-ins, and suggests targets from it. You choose: Apply, Adjust or Keep."
        onDone={() => { markOb(["tips", "firstTargets"]); setTipOpen(null); }}><FirstTargetsDemo c={coaching} /></TipCard>
    ) : null;

  return (
    <div style={S.app}>
      <Style />
      {showBwModal && ob?.setup && <BodyweightModal onSave={saveBodyweight} onSkip={skipBodyweight} />}
      {ob && !ob.tour && <MealPrepTour training={training} onDone={finishTour} />}
      {ob && ob.tour && setup?.step === "phase" && <SetupPhaseChoice onContinue={(type) => setSetup({ step: "calc", type })} />}
      {ob && setup?.step === "calc" && (
        <TargetsCalculator presets={phases} bwLog={bwLog} profile={savedProfile || session?.user?.user_metadata?.profile}
          training={training} setupType={setup.type} onApply={applySetup} onClose={() => {}} />
      )}
      {ob && setup?.step === "next" && <SetupWhatsNext phaseType={setup.type} onContinue={() => setSetup({ ...setup, step: "weigh" })} />}
      {ob && setup?.step === "weigh" && (
        <BodyweightModal setup initial={setup.weight ?? null}
          onSave={async (w) => { await saveBodyweight(w); finishSetup(); }}
          onSkip={() => { skipBodyweight(); finishSetup(); }} />
      )}
      {laterTip}
      {calc && (
        <TargetsCalculator
          presets={phases}
          bwLog={bwLog}
          profile={savedProfile || session?.user?.user_metadata?.profile}
          training={calc.training}
          onApply={applyCalc}
          onClose={() => setCalc(null)}
        />
      )}
      {showMonth && (
        <MonthSheet
          selectedDate={selectedDate}
          dietPhases={dietPhases}
          presets={phases}
          onSelectDate={(iso) => { setSelectedDate(iso); setShowMonth(false); }}
          onEdit={editDietPhases}
          onClose={() => setShowMonth(false)}
          planTip={obReady && !ob.tips?.planPhase}
          onPlanTipDone={() => markOb(["tips", "planPhase"])}
          trainingGoal={training?.active ? training.goal || null : null}
          goalLive={training?.active && training.goal ? goalLiveOf(dietPhaseContext(dietPhases, todayISO(), bwLog), todayISO()) : null}
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
            planStore={planStore}
            planMonday={planMonday}
            todayWeek={todayWeek}
            planFoodsKept={planFoodsKept}
            foods={foods}
            setFoods={setFoods}
            phases={phases}
            activeDay={activeDay}
            setActiveDay={setActiveDay}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            dietPhases={dietPhases}
            training={training}
            bwLog={bwLog}
            targetHistory={targetHistory}
            loggable={loggable}
            intakeRows={loggable ? intake[selectedDate] || null : null}
            intakeError={intakeError}
            onRetryIntake={() => reloadIntake(selectedDate)}
            intakeOps={intakeOps}
            coaching={coaching}
            coachError={coachError}
            onSetDayIncluded={setDayIncluded}
            onCompleteCheckin={completeCheckin}
            onCheckinReason={resolveAutoCheckin}
            onAcceptCatchUp={acceptCatchUp}
            onReplan={replan}
            onHoldCurrent={holdCurrentWeight}
            reviewDays={reviewDays}
            onOpenMonth={() => setShowMonth(true)}
            showCalcPrompt={!!ob?.setup && !calcLater && phases.some((p) => p.example)}
            onOpenCalc={openCalc}
            onCalcLater={laterCalc}
            strengthChoice={strengthChoice}
            onSlowCut={slowCut}
            onKeepStrength={(changePct) => rememberStrengthChoice("keep", changePct)}
            topCards={topCards}
            nudge={nudge}
            onDismissNudge={dismissNudge}
            copyTipAllowed={obReady && !ob.tips?.copyMeal && !laterTip}
            onCopyTipDone={() => markOb(["tips", "copyMeal"])}
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
            targetHistory={targetHistory}
            coaching={coaching}
            training={training}
            week={todayWeek}
            onSavePreset={savePresetTarget}
            onSaveActive={saveActiveTarget}
            onSwitchPhase={switchPhase}
            onOpenCalendar={() => { setTab("plan"); setShowMonth(true); }}
            onOpenCalc={openCalc}
          />
        )}
        {tab === "data" && (
          <Data
            foods={foods}
            phases={phases}
            week={planStore}
            setFoods={setFoods}
            setPhases={setPhases}
            setWeek={setPlanStore}
            debugLog={debugLog}
            session={session}
            onDeleteStart={() => { accountGoneRef.current = true; }}
            onDeleteFailed={() => { accountGoneRef.current = false; }}
            onAccountDeleted={handleAccountDeleted}
          />
        )}
      </main>
    </div>
  );
}

/* ============================================================
   PLAN
   ============================================================ */
function Plan({ week, setWeek, planStore, planMonday, todayWeek, planFoodsKept, foods, setFoods, phases, activeDay, setActiveDay, selectedDate, setSelectedDate, dietPhases, training, bwLog, targetHistory, loggable, intakeRows, intakeError, onRetryIntake, intakeOps, coaching, coachError, onSetDayIncluded, onCompleteCheckin, onCheckinReason, onAcceptCatchUp, onHoldCurrent, onReplan = null, reviewDays = false, onOpenMonth, showCalcPrompt, onOpenCalc, onCalcLater, strengthChoice, onSlowCut, onKeepStrength, topCards = null, nudge = false, onDismissNudge, copyTipAllowed = false, onCopyTipDone }) {
  const day = week[activeDay];
  // The day's macro targets: the preset of the diet phase in effect on the
  // selected date, unless this weekday has its own override (e.g. Refeed).
  const dietPhaseOnDay = phaseOnDate(dietPhases, selectedDate);
  // targets as they were on the selected date (a past day keeps its old numbers)
  const dated = presetsAsOf(phases, targetHistory, selectedDate);
  const followed = dietPhaseOnDay ? dated.find((p) => p.id === dietPhaseOnDay.phase_id) || null : null;
  const override = day.targetId ? dated.find((p) => p.id === day.targetId) || null : null;
  const phase = override || followed;
  const followLabel = followed
    ? `${followed.name} (diet phase)`
    : dietPhaseOnDay
      ? `${dietPhaseOnDay.phase_name} — no matching targets`
      : "no diet phase set";
  // Where a picked / scanned food goes:
  //   { mode: "template", slotId }            → this week's plan for this weekday
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

  // first time an empty meal can be copied from an earlier week: one tip
  const copyTipDue = copyTipAllowed && planFoodsKept && day.slots.some((slot) => !slot.entries.length && !!lastPlannedMeal(planStore, planMonday, activeDay, slot));

  return (
    <div>
      {topCards}
      {copyTipDue && (
        <TipCard title="New week, same meals" caption="An empty meal's ⋮ menu." onDone={onCopyTipDone}
          body={'Each week starts with empty meals. Tap a meal\'s ⋮ and choose "copy from last week" to bring its foods back in one tap.'}>
          <CopyMenuPicture />
        </TipCard>
      )}
      {showCalcPrompt && (
        <div style={S.calcPrompt}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Set your starting targets</div>
          <div style={{ fontSize: 13, color: dim, marginBottom: 10 }}>Your targets are example numbers. Answer a few questions (about a minute) to get your own.</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ ...S.primaryBtn, flex: 2 }} onClick={onOpenCalc}>Calculate my targets</button>
            <button style={{ ...S.ghostBtn, flex: 1 }} onClick={onCalcLater}>later</button>
          </div>
        </div>
      )}
      {selectedDate === coaching?.today && coaching?.due && (
        coaching.suggestion && !reviewDays && dietPhases && phaseOnDate(dietPhases, coaching.today)?.phase_type === "maintenance" && catchUpStarting(coaching.hold)
          ? <CatchUpProposal c={coaching} onAccept={onAcceptCatchUp} onHoldCurrent={onHoldCurrent} />
          : <CheckInCard c={coaching} onToggleDay={onSetDayIncluded} onComplete={onCompleteCheckin} startShowDays={reviewDays} />
      )}
      {selectedDate === coaching?.today && coaching?.thisWeek?.chosen?.auto && (
        <AutoCheckinNotice c={coaching} phases={phases} onReason={onCheckinReason} />
      )}
      {coachError && <div style={S.verifyBanner}>⚠ couldn't load check-in data — {coachError}</div>}
      <PhaseCard dietPhases={dietPhases} bwLog={bwLog} onOpenMonth={onOpenMonth} presets={phases} week={todayWeek} estimate={coaching?.card} hold={coaching?.hold} onReplan={onReplan} trainingActive={training?.active} hasRepReport={!!training} deload={!!(training?.active && training.deload)}
        strength={training?.strength || null} strengthChoice={strengthChoice} weightLb={coaching?.weightLb ?? null} canSlow={!!coaching?.followed} onSlowCut={onSlowCut} onKeepStrength={onKeepStrength}
        trainingGoal={training?.active ? training.goal || null : null} nudge={nudge} onDismissNudge={onDismissNudge} />

      <DateStrip
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        dietPhases={dietPhases}
        onOpenMonth={onOpenMonth}
        onCopyDay={(d) => setCopySource(d)}
      />

      {!planFoodsKept && (
        <div style={{ fontSize: 13, color: dim, margin: "0 0 12px" }}>
          Plans older than {PLAN_KEEP_WEEKS} weeks keep their meals but not their foods. Foods you add here go straight to this day's log.
        </div>
      )}

      {/* phase + target dashboard */}
      <div style={S.dash}>
        <div style={S.dashHead}>
          {/* follows the diet phase by default; picking a preset overrides it
              for this weekday in this week's plan, and weeks you haven't
              edited after it inherit it (up to the next week you've edited) */}
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
                {p.name}
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
          {...(() => {
            // ⋮ "copy from last week": this meal's foods from the latest
            // earlier week it had any, on this weekday; only into an empty meal
            const src = planFoodsKept && !slot.entries.length ? lastPlannedMeal(planStore, planMonday, activeDay, slot) : null;
            const curMon = mondayOf(todayISO());
            const label = !src ? "last week" : src.monday === curMon ? "this week" : src.monday === addDaysISO(curMon, -7) ? "last week"
              : src.monday === addDaysISO(curMon, 7) ? "next week" : `the week of ${shortDate(src.monday)}`;
            return {
              copyPrevLabel: label,
              canCopyPrev: !!src,
              onCopyPrev: () => src && update((d) => { d.slots[si].entries = JSON.parse(JSON.stringify(src.entries)); }),
            };
          })()}
          onAdd={() => setPicker(loggedBySlot[slot.id] || !planFoodsKept ? { mode: "log", slotId: slot.id, slotName: slot.name } : { mode: "template", slotId: slot.id })}
          onScan={() => setScanTarget(loggedBySlot[slot.id] || !planFoodsKept ? { mode: "log", slotId: slot.id, slotName: slot.name } : { mode: "template", slotId: slot.id })}
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

      {loggable && coaching && selectedDate < coaching.today && (coaching.intakeByDate[selectedDate] || 0) > 0 && (
        <DayStatusRow
          included={dayIncluded(selectedDate, coaching.intakeByDate, coaching.statusByDate)}
          onChange={(v) => onSetDayIncluded(selectedDate, v)}
        />
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
/* ============================================================
   DAY STATUS — on a past day with food logged: does it count toward the
   maintenance estimate? A day you only partly logged would look like
   eating less than you did, so you can leave it out.
   ============================================================ */
function DayStatusRow({ included, onChange }) {
  return (
    <div style={S.dsRow}>
      <span>{included ? "✓ Counts toward your maintenance estimate" : "Left out of your estimate (partly logged)"}</span>
      <button style={S.dsBtn} onClick={() => onChange(!included)}>{included ? "mark partial" : "count it"}</button>
    </div>
  );
}

/* ============================================================
   WEEKLY CHECK-IN — shown on Plan (today) each Monday, or later that
   week if missed, until done. 1) confirm which of last week's days
   were fully logged; 2) see the maintenance estimate, your actual rate
   vs the phase's target, and the suggested targets; 3) Apply, Adjust
   (edit first) or Keep current. Every decision is saved.
   ============================================================ */
// The week a maintenance catch-up would start: what it is and what to
// expect, before anything changes. OK applies it; or hold where you are.
function CatchUpProposal({ c, onAccept, onHoldCurrent }) {
  const [busy, setBusy] = useState(false);
  const copy = catchUpCopy(c.hold, c.suggestion.cal);
  return (
    <div style={S.ciCard}>
      <div style={S.ciKicker}>WEEKLY CHECK-IN</div>
      <div style={{ ...S.ciLine, fontSize: 15, fontWeight: 700, marginTop: 6 }}>{copy.title}</div>
      <div style={S.ciSub}>{copy.context} {copy.body}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button style={{ ...S.primaryBtn, flex: 1 }} disabled={busy} onClick={async () => { setBusy(true); await onAccept(); setBusy(false); }}>OK</button>
        <button style={{ ...S.ghostBtn, flex: 1 }} disabled={busy} onClick={onHoldCurrent}>Stay at {c.hold.now.toFixed(1)} lb</button>
      </div>
    </div>
  );
}

// This week's maintenance check-in, applied for you: what changed and why,
// with "Something off?" for the reasons to change it (resolveCheckinReason).
function AutoCheckinNotice({ c, phases = [], onReason }) {
  const key = `mealprep:auto-checkin-seen:${c.weekStart}`;
  const [seen, setSeen] = useState(() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  const [open, setOpen] = useState(null); // null | "reasons" | "slow" | "cant-eat"
  const [busy, setBusy] = useState(false);
  const ck = c.thisWeek;
  if (seen || !ck?.chosen) return null;
  const fmt = (n) => Math.round(Number(n)).toLocaleString("en-US");
  const was = Number(ck.before?.cal), now = Number(ck.chosen.cal), est = Number(ck.estimate);
  const reason = ck.chosen.reason || null;
  const hold = c.hold;
  const close = () => { setSeen(true); try { localStorage.setItem(key, "1"); } catch { /* private mode */ } };
  const pick = async (r, opts) => { setBusy(true); await onReason(r, opts); setBusy(false); setOpen(null); };
  const lbWeek = (cal) => { const d = driftLbPerWeek(cal, est); return `${Math.abs(d) < 0.05 ? "hold steady" : `${d < 0 ? "lose" : "gain"} about ${Math.abs(d).toFixed(1)} lb a week`}`; };
  const slowOpt = (type) => {
    const preset = presetForType(phases, type);
    if (!preset) return null;
    const rate = type === "deficit" ? SLOW_CUT_PCT : SLOW_BULK_PCT;
    const weeks = defaultPhaseWeeks(preset);
    const cal = phaseCalTarget(est, rate, c.weightLb);
    const lb = c.weightLb ? Math.abs((rate / 100) * c.weightLb * (type === "surplus" ? WEEKS_PER_MONTH : 1)).toFixed(1) : null;
    return (
      <button key={type} style={S.ciReason} disabled={busy} onClick={() => pick(type === "deficit" ? "slow-cut" : "slow-bulk")}>
        <b>{type === "deficit" ? "Lose slowly · 0.25%/week" : "Gain slowly · +0.5%/month"}</b>{lb ? ` (≈${lb} lb a ${type === "surplus" ? "month" : "week"})` : ""}
        <div style={{ color: dim, fontSize: 12, marginTop: 2 }}>Starts today{cal != null ? ` at ${fmt(cal)} kcal` : ""}, {weeks} weeks to {shortDate(addDaysISO(c.today, weeks * 7 - 1))}, then back to maintenance.</div>
      </button>
    );
  };
  // what happened, once a reason was picked
  const outcome = reason === "temporary" ? `Got it. Your calories stay at ${fmt(was)} this week. Next week's check-in will update them again.`
    : reason === "cant-eat" ? `Got it. ${fmt(was)} this week: at that you'll ${lbWeek(was)}. Next week's check-in will update them again.`
    : reason === "cant-eat-half" ? `Got it. ${fmt(now)} this week, halfway: at that you'll ${lbWeek(now)}. Next week's check-in moves you the rest.`
    : reason === "hold-reset" ? `Holding ${c.weightLb ? `${c.weightLb.toFixed(1)} lb` : "your current weight"} from now. Calories ${fmt(was)} → ${fmt(now)}, your maintenance.`
    : reason === "slow-cut" || reason === "slow-bulk" ? `${reason === "slow-cut" ? "Slow cut" : "Slow bulk"} started today. Your new targets are on the phase card.`
    : null;
  const reasons = checkinReasons(ck, hold);
  // stayed under two weeks running: make it the plan
  const lastWeek = (c.last?.chosen?.reason || "").startsWith("cant-eat");
  const lead = (
    <div style={{ ...S.ciLine, fontSize: 15, fontWeight: 700, marginTop: 6 }}>
      {was === now ? `Calories stay at ${fmt(now)}` : `Calories ${fmt(was)} → ${fmt(now)}`}
    </div>
  );
  return (
    <div style={S.ciCard}>
      <div style={S.ciKicker}>WEEKLY CHECK-IN</div>
      {outcome ? (
        <div style={{ ...S.ciLine, marginTop: 8 }}>{outcome}</div>
      ) : catchUpStarting(hold) ? (
        <>
          <div style={{ ...S.ciLine, fontSize: 15, fontWeight: 700, marginTop: 6 }}>{catchUpCopy(hold, now).title}</div>
          <div style={S.ciSub}>{catchUpCopy(hold, now).context} {catchUpCopy(hold, now).body}</div>
        </>
      ) : hold?.ratePct ? (
        <>
          <div style={{ ...S.ciLine, fontSize: 15, fontWeight: 700, marginTop: 6 }}>{Math.abs(hold.gapLb).toFixed(1)} lb to go</div>
          <div style={S.ciSub}>Back to {hold.anchor.toFixed(1)} lb at about {Math.abs((hold.ratePct / 100) * hold.now).toFixed(1)} lb a week. Calories {fmt(now)} this week.</div>
        </>
      ) : (
        <>
          {lead}
          <div style={S.ciSub}>
            {/* the first estimate from their data replaces the calculator's: say so once */}
            {c.firstData && c.prior != null && Math.round(est - c.prior) !== 0
              ? `Your real maintenance is ${fmt(est)} calories. That's ${fmt(Math.abs(est - c.prior))} ${est > c.prior ? "more" : "less"} than the starting estimate. Each weekly check-in fine-tunes it from your latest logging and weigh-ins.`
              : `Your maintenance from the last 3 weeks of logging and weigh-ins is ${fmt(est)} kcal.`}
          </div>
          {open === "reasons" && (
            <div style={{ marginTop: 10 }}>
              {reasons.includes("log") && <button style={S.ciReason} disabled={busy} onClick={() => pick("log")}><b>My log was incomplete</b><div style={{ color: dim, fontSize: 12, marginTop: 2 }}>Fix last week's days; the check-in runs again from them.</div></button>}
              {reasons.includes("temporary") && <button style={S.ciReason} disabled={busy} onClick={() => pick("temporary")}><b>My weight is temporarily off</b><div style={{ color: dim, fontSize: 12, marginTop: 2 }}>Travel, illness, a salty weekend, your cycle. Stay at {fmt(was)} this week.</div></button>}
              {reasons.includes("slow") && <button style={S.ciReason} disabled={busy} onClick={() => setOpen("slow")}><b>I want to lose or gain slowly</b></button>}
              {reasons.includes("hold-reset") && <button style={S.ciReason} disabled={busy} onClick={() => pick("hold-reset")}><b>Hold my current weight instead</b><div style={{ color: dim, fontSize: 12, marginTop: 2 }}>Stop winning back {Math.abs(hold.gapLb).toFixed(1)} lb and hold {c.weightLb ? c.weightLb.toFixed(1) : "your weight"} from now.</div></button>}
              {reasons.includes("cant-eat") && <button style={S.ciReason} disabled={busy} onClick={() => setOpen("cant-eat")}><b>I can't eat that right now</b></button>}
            </div>
          )}
          {open === "slow" && <div style={{ marginTop: 10 }}>{slowOpt("deficit")}{slowOpt("surplus")}</div>}
          {open === "cant-eat" && (
            <div style={{ marginTop: 10 }}>
              {lastWeek && <div style={{ ...S.ciSub, color: "#ffb454", marginBottom: 8 }}>You've stayed under 2 weeks running. If this is what you can eat, a slow {now > was ? "cut" : "bulk"} makes it the plan instead of a drift.</div>}
              <button style={S.ciReason} disabled={busy} onClick={() => pick("cant-eat", { half: true })}>
                <b>Meet halfway: {fmt((was + now) / 2)}</b><div style={{ color: dim, fontSize: 12, marginTop: 2 }}>You'll {lbWeek((was + now) / 2)}. Next week moves you the rest.</div>
              </button>
              <button style={S.ciReason} disabled={busy} onClick={() => pick("cant-eat")}>
                <b>Stay at {fmt(was)} this week</b><div style={{ color: dim, fontSize: 12, marginTop: 2 }}>You'll {lbWeek(was)}.</div>
              </button>
              {lastWeek && slowOpt(now > was ? "deficit" : "surplus")}
            </div>
          )}
        </>
      )}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
        <button style={{ ...S.primaryBtn, flex: 1 }} onClick={close}>{open && !outcome ? `Use ${fmt(now)}` : "OK"}</button>
        {!outcome && !open && reasons.length > 0 && !catchUpStarting(hold) && <button style={{ ...S.linkBtn, color: dim }} onClick={() => setOpen("reasons")}>Something off?</button>}
        {!outcome && open && <button style={{ ...S.linkBtn, color: dim }} onClick={() => setOpen(open === "reasons" ? null : "reasons")}>back</button>}
      </div>
    </div>
  );
}

function CheckInCard({ c, onToggleDay, onComplete, startShowDays = false }) {
  const [adjusting, setAdjusting] = useState(false);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const s = c.suggestion;
  const cur = c.followed.target;
  const fmtDay = (iso) => parseISO(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(c.today, -(i + 1)));
  const logged = days.filter((d) => (c.intakeByDate[d] || 0) > 0);
  const empty = days.length - logged.length;
  const needDays = Math.max(0, EST_MIN_INCLUDED - c.raw.includedDays);
  const needWeigh = Math.max(0, EST_MIN_WEIGHINS - c.raw.weighInDays);
  const signed = (n, d = 0) => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n).toFixed(d);
  // Edit: calories are their own field (changing them is the Adjust that
  // resets the estimate); a macro edit holds them and balances (balanceMacros)
  const editCheck = edit ? checkMacros(edit, edit.cal, { phaseType: c.followed.phase_type, weightLb: c.weightLb }) : null;
  const calChanged = !!edit && s && edit.cal !== s.cal;
  const [showDays, setShowDays] = useState(startShowDays);
  const counted = logged.filter((d) => dayIncluded(d, c.intakeByDate, c.statusByDate)).length;

  const finish = async (action, chosen) => {
    setBusy(true);
    await onComplete(action, chosen);
    setBusy(false);
  };

  return (
    <div style={S.ciCard}>
      <div style={S.ciKicker}>WEEKLY CHECK-IN · {fmtDay(c.today).toUpperCase()}</div>

      {/* 1 — which days count */}
      <div style={S.ciStep}>1 · Check last week's log</div>
      <div style={S.ciLine}>
        {logged.length === 0 ? "Nothing logged last week." : <>
          Counting <b>{counted} of {logged.length}</b> logged day{logged.length === 1 ? "" : "s"}
          {empty > 0 && empty < 7 && <span style={{ color: dim }}> · {empty} empty, skipped</span>}
          {" "}<button style={S.linkBtn} onClick={() => setShowDays(!showDays)}>{showDays ? "done" : "review"}</button>
        </>}
      </div>
      {showDays && logged.length > 0 && (
        <>
          <div style={S.ciSub}>Untick any day you didn't log completely; a half-logged day makes it look like you ate less than you did.</div>
          {logged.map((d) => (
            <label key={d} style={S.ciDay}>
              <input type="checkbox" checked={dayIncluded(d, c.intakeByDate, c.statusByDate)} onChange={(e) => onToggleDay(d, e.target.checked)} />
              <span style={{ flex: 1 }}>{fmtDay(d)}</span>
              <span style={{ color: dim }}>{Math.round(c.intakeByDate[d]).toLocaleString()} kcal</span>
            </label>
          ))}
        </>
      )}

      {/* 2 — what the data says */}
      <div style={S.ciStep}>2 · What your data says</div>
      {c.raw.raw == null ? (
        <div style={S.ciLine}>
          Not enough data yet. Needs {[
            needDays ? `${needDays} more fully logged day${needDays === 1 ? "" : "s"}` : null,
            needWeigh ? `${needWeigh} more weigh-in${needWeigh === 1 ? "" : "s"}` : null,
          ].filter(Boolean).join(" and ") || "a few more days of data"} in the last 3 weeks.
          <div style={S.ciSub}>Maintenance estimate stays at <b>{Math.round(c.estimate).toLocaleString()} kcal</b> ({c.last ? "last week's" : "your starting guess"}).</div>
        </div>
      ) : (
        <div style={S.ciLine}>
          Maintenance estimate:{" "}
          {c.prior != null
            ? <><span style={{ color: dim }}>{Math.round(c.prior).toLocaleString()} →</span> <b>{Math.round(c.estimate).toLocaleString()} kcal</b> <span style={{ color: dim }}>({signed(c.estimate - c.prior)})</span></>
            : <b>{Math.round(c.estimate).toLocaleString()} kcal</b>}
          <div style={S.ciSub}>From what you ate and how your weight moved over the last 3 weeks. {c.firstData
            ? "Your first estimate from your own data, so it replaces the starting guess; after this it moves a little each week."
            : c.agrees
            ? "It moved further than usual because last week's data pointed the same way."
            : "It moves a little each week, so one odd stretch (like a water-weight jump) can't swing it."}</div>
        </div>
      )}

      {s && (
        <>
          <div style={S.ciStep}>3 · Suggested targets ({c.followed.name})</div>
          {c.ratePct !== 0 && (
            <div style={S.ciSub}>Maintenance {signed(s.cal - Math.round(c.estimate))} kcal, to aim for {signed(c.ratePct, 2)}%/wk{c.hold?.ratePct ? `, back toward ${c.hold.anchor.toFixed(1)} lb` : ""}.</div>
          )}
          <div style={S.ciTable}>
            {[["Calories", "cal"], ["Protein", "p"], ["Fat", "f"], ["Carbs", "c"]].map(([lab, k]) => (
              <div key={k} style={S.ciCell}>
                <div style={{ color: dim, fontSize: 11 }}>{lab}</div>
                {adjusting ? (
                  <NumInput type="number" inputMode="numeric" value={edit[k]} aria-label={lab}
                    onChange={(e) => setEdit(k === "cal"
                      ? (() => { const cal = Math.max(0, Math.round(parseFloat(e.target.value) || 0)); const t = fitMacros(edit, cal); return { p: t.p, f: t.f, c: t.c, cal }; })()
                      : { ...balanceMacros(edit, k, e.target.value, edit.cal), cal: edit.cal })}
                    style={{ ...S.fInput, padding: "4px 6px" }} />
                ) : (
                  <div style={{ fontWeight: 700 }}>{s[k].toLocaleString()}{k === "cal" ? "" : " g"}</div>
                )}
                <div style={{ color: dim, fontSize: 11 }}>now {Math.round(cur[k]).toLocaleString()}</div>
              </div>
            ))}
          </div>
          <div style={S.ciNotes}>
            {s.capped && <div>• Capped at ±{s.maxChange} kcal this week (the data points to {s.ideal.toLocaleString()}).</div>}
            {s.proteinRaised && <div>• Protein raised to the {c.followed.phase_type === "deficit" ? "cut minimum (about 0.9 g per pound of bodyweight)" : "minimum (about 0.7 g per pound)"}.</div>}
            {s.fatRaised && <div>• Fat raised to 20% of calories.</div>}
            {!s.proteinRaised && !s.fatRaised && s.cal !== Math.round(cur.cal) && <div>• Protein and fat stay; carbs take the change.</div>}
            {s.tooFast && <div style={{ color: "#ffb454" }}>▲ This would mean losing faster than 1% of bodyweight a week — the top of the range for keeping muscle.</div>}
            {!adjusting && <div>• Keep leaves {c.followed.name} at {Math.round(cur.cal).toLocaleString()}. Whichever you pick, your other targets follow the new estimate (see Phases).</div>}
            {adjusting && <div>• Protein or fat changes move carbs; carbs move fat. Calories stay at {edit.cal.toLocaleString()} · fat at least {editCheck.fatMin} g (20%).</div>}
            {adjusting && (calChanged
              ? <div>• You changed calories, so {edit.cal.toLocaleString()} becomes the new maintenance estimate{c.ratePct ? " (less what the phase's pace adds)" : ""}, and next week starts from it instead of pulling you back.</div>
              : <div>• Same calories as suggested: only the split changes, and the estimate stays at {Math.round(c.estimate).toLocaleString()}.</div>)}
            {adjusting && editCheck.errors.map((e) => <div key={e} style={{ color: "#ff8a5c" }}>✕ {e}</div>)}
            {adjusting && editCheck.notes.map((n) => <div key={n} style={{ color: "#ffb454" }}>▲ {n}</div>)}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {!adjusting ? (
              <>
                <button style={{ ...S.primaryBtn, flex: 1 }} disabled={busy} onClick={() => finish("apply", { p: s.p, f: s.f, c: s.c, cal: s.cal })}>Use {s.cal.toLocaleString()}</button>
                <button style={{ ...S.ghostBtn, flex: 1 }} disabled={busy} onClick={() => { setEdit({ p: s.p, f: s.f, c: s.c, cal: s.cal }); setAdjusting(true); }}>Edit</button>
                <button style={{ ...S.ghostBtn, flex: 1 }} disabled={busy} onClick={() => finish("keep", null)}>Keep {Math.round(cur.cal).toLocaleString()}</button>
              </>
            ) : (
              <>
                <button style={{ ...S.primaryBtn, flex: 2 }} disabled={busy || !editCheck.ok} onClick={() => finish("adjust", { ...edit })}>
                  {calChanged ? `Use ${edit.cal.toLocaleString()}` : `Use ${edit.cal.toLocaleString()} with this split`}
                </button>
                <button style={{ ...S.ghostBtn, flex: 1 }} disabled={busy} onClick={() => setAdjusting(false)}>back</button>
              </>
            )}
          </div>
        </>
      )}
      {!s && (
        <>
          {c.raw.raw == null && <div style={S.ciNotes}>Nothing to change yet. New targets come once the estimate is from your own data.</div>}
          <button style={{ ...S.ghostBtn, width: "100%", marginTop: 10 }} disabled={busy} onClick={() => finish("keep", null)}>
            {c.raw.raw == null ? "Got it" : "Done — no suggestion this week"}
          </button>
        </>
      )}
    </div>
  );
}

// RepReport's deload week, said where Meal Prep talks about training volume.
// Calories stay as planned: the lighter week saves only ~70-140 kcal/day of
// training, and it exists for recovery, which eating less would work against.
const DELOAD_NOTE = "Deload week in RepReport: sets are cut about in half and loads lightened so you can recover. Keep calories as planned — eating less would work against that.";

/* ---------- strength during a cut (from RepReport) ----------
   RepReport checks whether your lifts are holding up since the cut began
   (its computeCutStrength, saved as status.strength). The phase card shows:
   a line on how strength is doing, a heads-up when most muscles are about
   3% down two readings running, and a suggestion to slow the cut when most
   are 5% down (8% while the cut's first block is all there is to compare).
   Keeping calories or slowing the cut quiets the suggestion for 2 weeks,
   unless lifts drop another 2 points. Slowing applies in one step: the
   ±250 kcal weekly limit is for corrections from noisy data, and this is
   your decision. Thresholds are the owner's coaching choices (Oct 2026). */
const STRENGTH_QUIET_DAYS = 14;
const STRENGTH_WORSE_POINTS = 2;
const STRENGTH_STALE_DAYS = 21;
const STRENGTH_SLOW_TO_PCT = -0.5;

const shortDate = (iso) => parseISO(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
function formatLift(s, units) {
  return `${liftLoad(s, units)}×${s.reps} (${s.rir} left)`;
}
function liftLoad(s, units) {
  const kg = (s.units || units) === "kg" ? " kg" : "";
  return s.kind === "bodyweight" ? "bodyweight" : s.kind === "assisted" ? `${s.weight}${kg} assist` : `${s.weight}${kg}`;
}
// The sets RepReport scored: "225×7, 225×5 (2 left)" when the sets share a
// weight and reps in reserve, else each set in full.
function formatLifts(sets, units) {
  if (sets.length === 1) return formatLift(sets[0], units);
  const same = sets.every((x) => x.rir === sets[0].rir);
  return same
    ? `${sets.map((x) => `${liftLoad(x, units)}×${x.reps}`).join(", ")} (${sets[0].rir} left)`
    : sets.map((x) => formatLift(x, units)).join(", ");
}

// What the phase card says about strength, or null when there's nothing to
// show (not a cut, no RepReport reading, or one for a different cut).
// cutStart is the start of the cut's chain (dietPhaseContext's chainStart):
// a cut after a short diet break continues the one before it.
function strengthView({ strength, phase, cutStart, choice, today, ratePct, weightLb, actualPct, canSlow = true }) {
  if (!strength || phase?.phase_type !== "deficit" || !cutStart || strength.cutStart !== cutStart) return null;
  const age = strength.asOf ? daysBetween(strength.asOf, today) : null;
  const asOf = age != null && age > 7 ? ` (as of ${shortDate(strength.asOf)})` : "";
  const r = strength.changePct == null ? null : Math.round(strength.changePct);
  let line;
  if (r == null) line = "Strength since the cut began: not enough sessions yet to compare.";
  else if (strength.mode !== "trend" && strength.level !== "suggest") line = "Strength since the cut began: checking. The full comparison starts once you've repeated weeks of an earlier block in this cut.";
  else line = `Strength since the cut began: ${r > -3 ? `holding (${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(r)}%)` : `down about ${Math.abs(r)}%`}${asOf}.`;
  // an old reading is shown, but not acted on
  if (age != null && age > STRENGTH_STALE_DAYS) return { line, level: "none" };
  const ex = strength.example;
  const lift = !ex ? ""
    : ex.beforeSets && ex.afterSets
      ? ` (${ex.name}: ${formatLifts(ex.beforeSets, ex.units)} → ${formatLifts(ex.afterSets, ex.units)})`
      : ` (${ex.name}: ${formatLift(ex.before, ex.units)} → ${formatLift(ex.after, ex.units)})`;
  const across = `down about ${Math.abs(r)}% across ${strength.musclesDown} of ${strength.musclesScored} muscles since the cut began${lift}`;
  if (strength.level === "headsUp") {
    return { line, level: "headsUp", message: `Heads-up: your lifts are ${across}. Nothing to change yet. Worth watching.` };
  }
  if (strength.level !== "suggest") return { line, level: "none" };
  const quiet = choice?.date && daysBetween(choice.date, today) < STRENGTH_QUIET_DAYS
    && !(choice.changePct != null && strength.changePct <= choice.changePct - STRENGTH_WORSE_POINTS);
  if (quiet) {
    const did = choice.action === "slow" ? "slow the cut" : "keep calories";
    return { line, level: "quiet", message: `You chose to ${did} on ${shortDate(choice.date)}. The suggestion comes back on ${shortDate(addDaysISO(choice.date, STRENGTH_QUIET_DAYS))} unless your lifts drop further.` };
  }
  const pace = actualPct != null && actualPct < 0 ? ` Losing ${Math.abs(actualPct).toFixed(1)}% a week may be costing muscle.` : "";
  // each 0.5%/week of pace is about 2.5 kcal a day per lb of bodyweight
  const deltaKcal = canSlow && weightLb && ratePct < STRENGTH_SLOW_TO_PCT - EPS
    ? Math.round((((STRENGTH_SLOW_TO_PCT - ratePct) / 100) * weightLb * KCAL_PER_LB) / 7 / 10) * 10
    : 0;
  const offer = deltaKcal > 0 ? { deltaKcal } : null;
  return {
    line, level: "suggest", offer,
    message: `Your lifts are ${across}.${pace}`,
    options: offer
      ? "Slow to 0.5% a week, or plan a 1–2 week diet break at maintenance on the calendar."
      : "Consider a 1–2 week diet break at maintenance on the calendar.",
  };
}

/* ---------- goal check (mirrors RepReport) ----------
   One line on what RepReport's block and the diet phase are doing together,
   and a warning when they pull apart, naming the app to change. A straight
   port of RepReport's goalCheck (wording included); keep the two in step.
   Cutoffs are the owner's (Oct 2026): a bulk with no muscle above Maintain
   (not a strength block, which holds every muscle at maintain by design);
   a strength or powerbuilding block on a cut faster than 0.7%/week (the
   cut's held pace, as RepReport's own fast-cut rules read it). */
const GOAL_FAST_CUT_PCT = 0.7; // %/week
const goalList = (xs) => (xs.length <= 1 ? xs[0] || ""
  : xs.length <= 4 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`
  : `${xs.slice(0, 3).join(", ")} and ${xs.length - 3} more`);
const goalPct = (x) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${+Math.abs(x).toFixed(2)}%`;
const isStrengthGoal = (g) => g === "strength" || g === "powerbuilding";
// goal: training status goal. phase: { type, kind, targetPct (planned
// %/week or null), pacePct (a cut's held %/week loss) } or null.
function goalCheck(goal, phase) {
  if (!goal) return null;
  const g = goal.primaryGoal;
  const emph = goal.focus?.emphasize || [];
  const growing = emph.length > 0 || (goal.focus?.primary || []).length > 0;
  const nLifts = goal.mainLifts?.length || 0;
  const lifts = !nLifts ? "" : nLifts > 3 ? ` on your ${nLifts} main lifts` : ` on ${goalList(goal.mainLifts)}`;
  // On a cut, emphasized muscles are "prioritized" and the rest held; on a
  // cut fast enough for the strength warning, strength is "held" too.
  const cut = phase?.type === "deficit";
  const fastCut = cut && Math.round((phase.pacePct ?? 0) * 10 + 1e-9) / 10 > GOAL_FAST_CUT_PCT + 1e-9; // to one decimal, as RepReport's fastCutPace
  const build = emph.length ? `${cut ? "prioritizing" : "building"} ${goalList(emph)}` : growing && !cut ? "building muscle" : "holding muscle";
  const strong = `${fastCut ? "Holding strength" : "Getting stronger"}${lifts}`;
  const what = g === "strength" ? strong
    : g === "powerbuilding" ? `${strong} while ${build}`
    : build.charAt(0).toUpperCase() + build.slice(1);
  let where = "";
  if (phase?.type === "deficit") where = ` on a ${phase.kind === "minicut" ? "mini-cut" : "cut"}${phase.targetPct != null ? ` (${goalPct(phase.targetPct)}/week)` : ""}`;
  else if (phase?.type === "surplus") where = ` on a bulk${phase.targetPct != null ? ` (${goalPct(phase.targetPct * WEEKS_PER_MONTH)}/month)` : ""}`;
  else if (phase?.type === "maintenance") where = " at maintenance";
  const recomp = phase?.type === "maintenance" && g !== "strength" && growing;
  const summary = `${what}${where}${recomp ? ": expect slow, steady gains" : ""}.`;
  const conflicts = [];
  if (phase?.type === "surplus" && g !== "strength" && !growing) {
    conflicts.push({ id: "bulk-no-growth", text: "Your block holds every muscle at maintenance volume, so a bulk mostly adds fat. Change the block's goal in RepReport, or switch to maintenance calories in Meal Prep." });
  }
  if (fastCut && isStrengthGoal(g)) {
    conflicts.push({ id: "strength-fast-cut", text: "On a cut this fast, holding your main lifts is the win, and RepReport won't add sets to them. PRs are unlikely until you're back at maintenance. If PRs matter more right now, slow the cut to 0.7% a week or less in Meal Prep." });
  }
  return { summary, conflicts };
}
// The diet phase as goalCheck reads it, from a dietPhaseContext result.
const goalPhaseOf = (ctx) => (ctx ? {
  type: ctx.type, kind: ctx.kind,
  targetPct: ctx.phase?.target_rate_pct != null && Number.isFinite(Number(ctx.phase.target_rate_pct)) ? Number(ctx.phase.target_rate_pct) : null,
  pacePct: ctx.type === "deficit" ? (ctx.heldStrength ?? ctx.strength ?? 0) * VOLUME_DEFICIT_FULL_RATE * 100 : null,
} : null);

// The goal check for a plan: a block (goal.block dates) against the diet
// phases overlapping it. A phase planned ahead is checked at its planned
// pace (a cut with none set counts as 0.5%/week, a mini-cut as 1%); the
// phase running today at the pace the scale has held (live: { blockStart,
// today, pacePct }, as the phase card reads it). Only the goal warnings:
// how to line phases up with blocks is a coach's call (owner, Oct 2026).
// Items: { type: "conflict", id, start (the phase row's start), text }. A
// straight port of RepReport's goalPlanCheck; keep the two in step.
function goalPlanCheck(goal, rows, live = null) {
  const blk = goal?.block;
  if (!blk || !rows?.length) return [];
  const items = [];
  phaseBlocks(rows).forEach((b) => {
    b.rows.forEach((r, i) => {
      const next = b.rows[i + 1];
      // a row ends at its own end_date or the day before the next row, whichever is first
      const rEnd = [r.end_date, next ? addDaysISO(next.start_date, -1) : b.end].filter(Boolean).sort()[0] || null;
      if ((rEnd && rEnd < blk.start) || r.start_date > blk.end) return; // outside the block
      const t = r.target_rate_pct != null && Number.isFinite(Number(r.target_rate_pct)) ? Number(r.target_rate_pct) : null;
      const isLive = live && b.start === live.blockStart && r.start_date <= live.today;
      const pacePct = r.phase_type !== "deficit" ? null : isLive ? live.pacePct
        : t != null ? -t : (b.kind === "minicut" ? 1 : VOLUME_DEFAULT_STRENGTH) * VOLUME_DEFICIT_FULL_RATE * 100;
      goalCheck(goal, { type: r.phase_type, kind: b.kind, targetPct: t, pacePct }).conflicts
        .forEach((c) => items.push({ type: "conflict", id: c.id, start: r.start_date, text: c.text }));
    });
  });
  return items;
}
// The live half of a plan check, from a dietPhaseContext result on `today`.
const goalLiveOf = (ctx, today) => (ctx?.type === "deficit" ? { blockStart: ctx.blockStart, today, pacePct: goalPhaseOf(ctx).pacePct } : null);

// The goal check for a phase being planned in the editor, against your
// running RepReport block: the phase as planned (ending at its planned end,
// then the maintenance added after it when there is one), replacing the
// rows in `drop` (the phase being edited and its own maintenance), and
// only the items about this phase.
function phasePlanItems(trainingGoal, dietPhases, { preset, start, plannedEnd, targetRatePct, withMaintenance, drop = [], live = null }) {
  if (!preset || !trainingGoal?.block || !start) return [];
  const planned = { id: "__plan", phase_type: preset.phase_type, phase_name: preset.name, start_date: start, end_date: plannedEnd, planned_end_date: plannedEnd, target_rate_pct: targetRatePct };
  const after = withMaintenance && plannedEnd ? [{ id: "__maint", phase_type: "maintenance", phase_name: "Maintenance", start_date: addDaysISO(plannedEnd, 1), end_date: null, planned_end_date: null, target_rate_pct: 0 }] : [];
  const others = (dietPhases || []).filter((r) => !drop.includes(r.id));
  try { return goalPlanCheck(trainingGoal, [...others, planned, ...after], live).filter((it) => it.start === start); }
  catch (e) { console.error("Goal plan check failed:", e); return []; }
}

// A long cut's diet-break option (owner's choice, Oct 2026). Trials used
// 2–3 weeks of dieting per break and found about the same fat loss with or
// without breaks (MATADOR, Byrne et al. 2018; ICECAP, Peos et al.), so the
// 12 weeks is a practical choice, not a researched one. Counted from this
// cut's own start, so a cut right after a break starts over. Mini-cuts are
// short by design and get no note.
const DIET_BREAK_NOTE_WEEKS = 12;
function dietBreakNote({ phase, today, deload, trainingGoal }) {
  if (phase?.phase_type !== "deficit" || isMiniCut(phase.phase_type, phase.phase_name)) return null;
  const weeks = Math.floor(daysBetween(phase.start_date, today) / 7);
  if (weeks < DIET_BREAK_NOTE_WEEKS) return null;
  const d = trainingGoal?.block?.deloadStart;
  const when = deload ? " Your RepReport deload is this week."
    : d && d > today ? ` Your next RepReport deload starts ${shortDate(d)}.` : "";
  return `This cut has run ${weeks} weeks. A 1–2 week break at maintenance is an option; studies find about the same fat loss either way.${when}`;
}

// The first day the phase card shows a pace for the phase covering today, or
// null when it needn't wait: day 20 of the phase (its trend then starts after
// the first week's water swing), day 28 for a bulk's monthly trend. Waits on
// any cut, and on any phase that follows a different one. A run of back-to-back
// rows of the same type counts from the first.
// The pace verdict, actual vs target in display units (%/week, a bulk's
// %/month): on pace within ±0.2%/week on a cut, ±0.25%/month on a bulk;
// maintenance holds within ±0.25%/week. null without an actual pace.
function paceVerdict(type, actual, targetPct) {
  if (actual == null) return null;
  if (type === "maintenance") {
    return Math.abs(actual) <= 0.25 ? { ok: true, text: "Holding steady" }
      : { ok: false, text: actual > 0 ? "Drifting up" : "Drifting down" };
  }
  const tol = rateIsMonthly(type) ? 0.25 : 0.2;
  const diff = actual - targetPct;
  if (Math.abs(diff) <= tol) return { ok: true, text: "On pace" };
  if (type === "deficit") return { ok: false, text: actual >= 0 ? "Not losing yet" : diff > 0 ? "Losing slower than target" : "Losing faster than target" };
  return { ok: false, text: actual <= 0 ? "Not gaining yet" : diff < 0 ? "Gaining slower than target" : "Gaining faster than target" };
}

// The 2-week verdict, with the plan as a whole: "On pace now · 1.8 lb behind plan"
function behindVerdict(v, plan) {
  if (!v || !plan?.behind) return v;
  const lb = `${plan.behindLb.toFixed(1)} lb behind plan`;
  return { ok: false, text: v.ok ? `On pace now · ${lb}` : `${v.text} · ${lb}` };
}

function paceStartsOn(rows, phase, monthly) {
  if (!phase) return null;
  const sorted = [...(rows || [])].sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  let start = phase.start_date;
  let prev = null;
  for (let i = sorted.indexOf(phase) - 1; i >= 0; i--) {
    const r = sorted[i];
    if (r.phase_type === phase.phase_type && addDaysISO(r.end_date || r.planned_end_date || addDaysISO(start, -1), 1) >= start) { start = r.start_date; continue; }
    prev = r; break;
  }
  if (!prev && phase.phase_type !== "deficit") return null;
  return addDaysISO(start, monthly ? 27 : 19);
}

function PhaseCard({ dietPhases, bwLog, onOpenMonth, presets, week, estimate, hold = null, onReplan = null, trainingActive, hasRepReport = true, deload, strength, strengthChoice, weightLb, canSlow, onSlowCut, onKeepStrength, trainingGoal = null, nudge = false, onDismissNudge }) {
  const [strengthBusy, setStrengthBusy] = useState(false);
  const today = todayISO();
  const phase = phaseOnDate(dietPhases, today);

  if (!phase) {
    return (
      <button style={{ ...S.pcCard, ...S.pcEmpty }} onClick={onOpenMonth}>
        No diet phase set — tap to start one on the calendar
        {deload && <div style={{ ...S.viNote, color: PHASE_COLORS.maintenance }}>{DELOAD_NOTE}</div>}
      </button>
    );
  }

  const color = PHASE_COLORS[phase.phase_type];
  const prog = phaseProgress(phase, today);
  const pct = prog.plannedWeeks ? Math.min(100, (prog.week / prog.plannedWeeks) * 100) : null;
  const sign = (n, digits) => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n).toFixed(digits);
  const cals = phaseCalories(phase, presets || [], week);
  const ctx = dietPhaseContext(dietPhases, today, bwLog);
  const goal = goalCheck(trainingGoal, goalPhaseOf(ctx));
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
  // weekly phases keep the last trend through a gap in weigh-ins, as the
  // volume note does, so the two never disagree
  const last = !monthly && !trend.ready ? latestTrendRate(bwLog, today) : null;
  // After a change of phase (and on any cut), the first week's water swing
  // would read as a pace: the verdict waits until this phase has its own
  // trend, day 20 (a bulk's monthly trend: day 28). (Owner's call, Nov 2026)
  const paceFrom = paceStartsOn(dietPhases, phase, monthly);
  const paceWaiting = !!paceFrom && today < paceFrom;
  const actual = paceWaiting ? null : trend.ready ? (monthly ? trend.pctPerMonth : trend.pctPerWeek) : last?.rate != null ? last.rate * 100 : null;
  const actualAge = trend.ready ? 0 : last?.age ?? null;
  const sv = strengthView({ strength, phase, cutStart: ctx?.chainStart, choice: strengthChoice, today, ratePct, weightLb, actualPct: actual, canSlow });

  // pace: actual vs target, in display units
  const followedPreset = (presets || []).find((p) => p.id === phase.phase_id) || null;
  const plan = planStatus(phase, followedPreset, bwLog, today);
  const pace = behindVerdict(paceVerdict(phase.phase_type, actual, targetPct), plan);

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

  const targetShort = phase.phase_type === "maintenance" ? "hold ±0.25%" : `${sign(targetPct, 2)}%`;
  // what's still needed before there's a pace to show
  let weighPrompt = null;
  if (paceWaiting) {
    weighPrompt = `Your pace shows from ${shortDate(paceFrom)}, once this ${phase.phase_type === "deficit" ? (isMiniCut(phase.phase_type, phase.phase_name) ? "mini-cut" : "cut") : phase.phase_type === "surplus" ? "bulk" : "phase"} has its own weigh-ins (the first week after a change is mostly water).`;
  } else if (actual == null) {
    const now = Math.min(trend.recentCount, TREND_MIN_WEIGHINS);
    const before = Math.min(monthly ? trend.oldCount : trend.priorCount, TREND_MIN_WEIGHINS);
    const more = TREND_MIN_WEIGHINS - now;
    weighPrompt = before >= TREND_MIN_WEIGHINS && more > 0
      ? `Weigh in ${more} more time${more === 1 ? "" : "s"} this week to see your pace.`
      : `Your pace shows once you have ${monthly ? "4+ weigh-ins this week and 4 weeks ago" : "2 weeks with 4+ weigh-ins each"} (${now}/${TREND_MIN_WEIGHINS} this week).`;
  }
  // % vs maintenance only against an estimate from your own data
  const vsMaint = estimate?.estimated && cals ? ((cals.avg - estimate.kcal) / estimate.kcal) * 100 : null;

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
      {goal && (
        <div style={{ marginTop: 8 }}>
          <div style={{ ...S.viNote, color: text, marginTop: 0 }}>{goal.summary} <span style={{ color: dim }}>(your RepReport block)</span></div>
          {goal.conflicts.map((c) => (
            <div key={c.id} style={{ ...S.viNote, color: "#ffb454" }}>▲ {c.text}</div>
          ))}
        </div>
      )}
      {(() => {
        const breakNote = dietBreakNote({ phase, today, deload, trainingGoal });
        return breakNote && <div style={{ ...S.viNote, color: dim }}>{breakNote}</div>;
      })()}

      <div style={S.pcStats}>
        <div>
          <div style={S.pcStatL}>Calories</div>
          <div style={S.pcStatN}>{cals ? Math.round(cals.avg).toLocaleString() : "—"}</div>
          {vsMaint != null && (
            <div style={{ ...S.pcStatSub, color }}>{Math.abs(vsMaint) < 0.5 ? "maintenance" : `${sign(vsMaint, 0)}% vs maint.`}</div>
          )}
        </div>
        <div>
          <div style={S.pcStatL}>Pace /{per}</div>
          <div style={S.pcStatN}>{actual != null ? `${sign(actual, 1)}%` : "—"}</div>
          <div style={{ ...S.pcStatSub, color: dim }}>
            target {targetShort}{actualAge > 0 ? ` · ${actualAge}d ago` : ""}
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

      {pace && (
        <div style={{ ...S.pcPace, color: pace.ok ? accent : "#ffb454" }}>
          {pace.ok ? "●" : "▲"} {pace.text}
        </div>
      )}
      {/* behind plan: the ways back, where the pace is seen every day */}
      {plan?.behind && followedPreset && onReplan && (
        <BehindPlan row={phase} preset={followedPreset} plan={plan} today={today} dietPhases={dietPhases} onReplan={onReplan} />
      )}
      {weighPrompt && <div style={S.pcNeed}>{weighPrompt}</div>}
      {nudge && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13 }}>
          <button style={{ ...S.pcLink, flex: 1, textAlign: "left", padding: 0 }} onClick={onOpenMonth}>Planning a bulk or cut next? Set it up on the calendar ›</button>
          <button style={{ background: "none", border: "none", color: dim, cursor: "pointer", fontSize: 14, padding: 0 }} onClick={onDismissNudge} aria-label="dismiss">✕</button>
        </div>
      )}
      {estimate?.estimated && (
        <div style={S.pcEstimate}>
          Maintenance ≈ <b>{Math.round(estimate.kcal).toLocaleString()} kcal</b>
          <span style={{ color: dim }}> · from your log and weigh-ins</span>
        </div>
      )}
      {projection && <div style={S.pcProj}>{projection}</div>}
      {hold?.ratePct ? (
        <div style={{ ...S.pcProj, color: text }}>Getting back to {hold.anchor.toFixed(1)} lb · {Math.abs(hold.gapLb).toFixed(1)} lb to go</div>
      ) : null}

      {/* Training volume only means something with RepReport (owner's call, Nov 2026). */}
      {hasRepReport && (<>
      {/* In a deload week the deload is what's happening to training, so it
          takes the place of the diet's percentage and explanation. */}
      <div style={S.viHead}>
        <span>Training volume impact</span>
        {!deload && (
          <span style={{ color: impactColor, fontWeight: 700 }}>
            {impactR === 0 ? "baseline" : `${sign(impactR, 0)}%`}
          </span>
        )}
      </div>
      <div style={S.viBar}>
        <div style={{ ...S.viMarker, left: `calc(${markerPct}% - 7px)` }} />
      </div>
      {deload ? (
        <div style={{ ...S.viNote, color: PHASE_COLORS.maintenance }}>{DELOAD_NOTE}</div>
      ) : (
        <div style={S.viNote}>
          {volumeImpactNote(ctx, impactR, "").replace(/\s+/g, " ").trim()}
          {ctx?.fading ? ` The last ${KIND_LABEL[ctx.fading.type]} is still fading out (~${ctx.fading.weeksLeft} wk left).` : ""}
        </div>
      )}
      </>)}
      {note && <div style={{ ...S.viNote, color: PHASE_COLORS[phase.phase_type] }}>{note}</div>}
      {sv && (
        <div style={S.stBox}>
          <div style={S.stHead}>Strength (from RepReport)</div>
          <div style={S.viNote}>{sv.line}</div>
          {sv.message && (
            <div style={{ ...S.viNote, color: sv.level === "suggest" ? "#ffb454" : sv.level === "headsUp" ? text : dim }}>{sv.message}</div>
          )}
          {sv.level === "suggest" && (
            <>
              <div style={S.viNote}>{sv.options}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                {sv.offer && (
                  <button style={{ ...S.primaryBtn, flex: 2 }} disabled={strengthBusy}
                    onClick={async () => { setStrengthBusy(true); await onSlowCut(sv.offer.deltaKcal, strength.changePct); setStrengthBusy(false); }}>
                    Slow to 0.5%/week (+{sv.offer.deltaKcal} kcal/day)
                  </button>
                )}
                <button style={{ ...S.ghostBtn, flex: 1 }} disabled={strengthBusy}
                  onClick={async () => { setStrengthBusy(true); await onKeepStrength(strength.changePct); setStrengthBusy(false); }}>
                  Keep current
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {!hasRepReport && phase.phase_type === "deficit" && (
        <div style={S.stBox}>
          <div style={S.stHead}>Lifting during this cut?</div>
          <div style={S.viNote}>RepReport plans your sets around it and shows whether your lifts are holding up, the clearest sign you're keeping muscle. Sign in at <b style={{ color: accent }}>repreport.app</b> with this same email.</div>
        </div>
      )}
      {hasRepReport && trainingActive === false && (phase.phase_type === "deficit"
        ? <div style={{ ...S.viNote, color: text }}>No active RepReport block. Start one so your sets follow this cut and RepReport can check that your lifts hold up.</div>
        : <div style={S.viNote}>No active RepReport block — this applies when you start one.</div>)}
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
function MonthSheet({ selectedDate, dietPhases, presets, onSelectDate, onEdit, onClose, trainingGoal = null, goalLive = null, planTip = false, onPlanTipDone }) {
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
          {planTip && <PlanPhaseTip block={trainingGoal?.block || null} onDone={onPlanTipDone} />}
          <div style={S.monthGrid}>
            {DAYS.map((d) => (
              <div key={d} style={{ textAlign: "center", fontSize: 11, color: dim, paddingBottom: 4 }}>{d}</div>
            ))}
            {cells.map((iso) => {
              const inMonth = iso.slice(0, 7) === cursor.slice(0, 7);
              const ph = phaseOnDate(dietPhases, iso);
              const color = ph ? PHASE_COLORS[ph.phase_type] : null;
              const on = iso === (editMode ? editDay : selectedDate);
              // the running (or planned) RepReport block, from its goal status: an amber
              // underline and the week of the block (DL for the light week)
              const blk = trainingGoal?.block;
              const inBlock = !!blk && iso >= blk.start && iso <= blk.end;
              const inDeload = inBlock && !!blk.deloadStart && iso >= blk.deloadStart;
              const blockWeek = inBlock ? Math.floor(daysBetween(blk.start, iso) / 7) + 1 : null;
              // past days dimmed, today onward bright (owner's call, Nov 2026)
              const past = iso < today;
              return (
                <button
                  key={iso}
                  onClick={() => (editMode ? setEditDay(iso) : onSelectDate(iso))}
                  style={{
                    ...S.monthCell,
                    position: "relative",
                    opacity: inMonth ? 1 : 0.35,
                    background: color ? color + (past ? "18" : "55") : panel2,
                    border: on ? `1px solid ${text}` : `1px solid transparent`,
                    boxShadow: iso === today ? `inset 0 0 0 2px ${accent}` : "none",
                    color: on ? text : inMonth ? text : dim,
                    fontWeight: on ? 800 : 500,
                  }}
                >
                  {parseISO(iso).getDate()}
                  {inBlock && (
                    <>
                      <span style={{ position: "absolute", top: 3, right: 4, fontSize: 8, fontWeight: 800, color: REPREPORT_AMBER, letterSpacing: 0.2 }}>{inDeload ? "DL" : `W${blockWeek}`}</span>
                      <span style={{ display: "block", height: 3, width: "70%", margin: "2px auto 0", borderRadius: 2, background: REPREPORT_AMBER, opacity: inDeload ? 1 : 0.6 }} />
                    </>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10, fontSize: 11, color: dim }}>
            {[["deficit", "cut"], ["maintenance", "maintenance"], ["surplus", "bulk"]].map(([k, lab]) => (
              <span key={k}><span style={{ color: PHASE_COLORS[k] }}>■</span> {lab}</span>
            ))}
            {trainingGoal?.block && <span><span style={{ color: REPREPORT_AMBER }}>▬</span> <span style={{ color: REPREPORT_AMBER, fontWeight: 600 }}>RepReport</span> block · DL = light week (deload)</span>}
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
              trainingGoal={trainingGoal}
              goalLive={goalLive}
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
function PhaseDayEditor({ day, dietPhases, presets, onEdit, trainingGoal = null, goalLive = null }) {
  const covering = phaseOnDate(dietPhases, day);
  const [mode, setMode] = useState(covering ? "view" : "new");
  const blank = { presetId: "", start: day, weeks: "", openEnded: false, rate: "" }; // rate "" = default
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const typedPresets = presets.filter((p) => isPhaseType(p.phase_type));

  const startForm = (row) => {
    if (row) {
      const prog = phaseProgress(row, row.start_date);
      const m = rateIsMonthly(row.phase_type);
      const rate = row.target_rate_pct == null ? "" : String(Math.abs(roundRate(Number(row.target_rate_pct) * (m ? WEEKS_PER_MONTH : 1))).toFixed(2));
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
  // every cut has an end date: open-ended is for maintenance and bulks (owner's call, Nov 2026)
  const canOpenEnd = !preset || preset.phase_type !== "deficit";
  const openEnded = form.openEnded && canOpenEnd;
  const plannedEnd = openEnded || !weeksValue ? null : addDaysISO(form.start, weeksValue * 7 - 1);
  // a mini-cut with nothing planned after it switches to maintenance at its end
  const miniThenMaint = preset && isMiniCut(preset.phase_type, preset.name) && plannedEnd
    && !dietPhases.some((r) => r.id !== editingId && r.start_date > form.start && r.start_date <= addDaysISO(plannedEnd, 1));
  const autoMaint = typedBlock && plannedEnd ? suggestedMaintenanceWeeks(preset.phase_type, preset.name, weeksValue) : null;
  const ownMaint = mode === "edit" ? followingMaintenance(dietPhases, covering) : null;
  const blockedBy = autoMaint
    ? [...dietPhases]
        .filter((r) => r.id !== editingId && r !== ownMaint && r.start_date > form.start && r.start_date <= addDaysISO(plannedEnd, 1))
        .sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0] || null
    : null;

  // target rate, entered per week (cuts) or per month (bulks); stored per week.
  // Only the size is typed — phone number pads have no minus key — and the
  // phase type gives the sign (cuts lose, bulks gain).
  const monthly = preset ? rateIsMonthly(preset.phase_type) : false;
  const rateSign = preset?.phase_type === "deficit" ? -1 : 1;
  const rateUnit = preset?.phase_type === "deficit" ? "% loss/week" : monthly ? "% gain/month" : "%/week";
  // a blank rate is the preset's default (its own, else the phase type's)
  const defaultShown = preset ? Math.abs(presetRatePct(preset) * (monthly ? WEEKS_PER_MONTH : 1)) : 0;
  // Cuts: Helms et al. 2014. Bulks: Iraki et al. 2019 (0.25–0.5 %/week for
  // novice/intermediate, slower for advanced; no figure given for advanced).
  // Mini-cut rates are coaching practice, not research — labeled as such.
  const rateHint = !preset ? "" : preset.phase_type === "deficit"
    ? (isMiniCut(preset.phase_type, preset.name)
      ? "mini-cuts usually lose ~1.0–1.25 %/week (coaching practice, not studied)"
      : "research range 0.5–1.0 % loss/week")
    : preset.phase_type === "surplus"
      ? "research range ~1–2 %/month (0.25–0.5 %/week) for novice–intermediate · slower if advanced"
      : "";
  const rateWeekly = () => {
    if (!preset || preset.phase_type === "maintenance") return 0;
    if (form.rate === "") return roundRate(presetRatePct(preset));
    const n = Math.abs(parseFloat(form.rate)) * rateSign;
    return isNaN(n) ? null : roundRate(monthly ? n / WEEKS_PER_MONTH : n);
  };

  const rateCheck = preset ? checkPhaseRate(preset.phase_type, preset.name, rateWeekly()) : { level: "ok", message: "" };
  const planItems = phasePlanItems(trainingGoal, dietPhases, {
    preset, start: form.start, plannedEnd, targetRatePct: preset?.phase_type === "maintenance" ? 0 : rateWeekly(),
    withMaintenance: !!(autoMaint && !blockedBy), drop: [editingId, mode === "edit" ? ownMaint?.id : null], live: goalLive,
  });

  const save = async () => {
    if (!preset) return window.alert("pick a phase first");
    const target_rate_pct = rateWeekly();
    if (target_rate_pct == null) return window.alert("enter a target rate as a number");
    if (rateCheck.level === "block") return window.alert(rateCheck.message);
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
          disabled={openEnded}
          placeholder={defaultWeeks ? String(defaultWeeks) : "—"}
          value={form.weeks}
          onChange={(e) => setForm({ ...form, weeks: e.target.value })}
          style={{ ...S.fInput, flex: 1 }}
        />
        {canOpenEnd && (
          <label style={{ fontSize: 12, color: dim, display: "flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={form.openEnded} onChange={(e) => setForm({ ...form, openEnded: e.target.checked })} />
            open-ended
          </label>
        )}
      </div>
      <div style={{ fontSize: 12, color: dim, marginBottom: 10 }}>
        {plannedEnd ? `planned end: ${plannedEnd}` : "no planned end — runs until the next phase starts"}
        {autoMaint
          ? blockedBy
            ? ` · ${blockedBy.phase_name} is already planned right after, so no maintenance is added (suggested: ~${autoMaint} wk)`
            : ` · then ~${autoMaint} wk maintenance is added after it`
          : miniThenMaint ? " · then maintenance until you pick what's next" : ""}
      </div>
      {planItems.map((it) => (
        <div key={`${it.id}-${it.start}`} style={{ fontSize: 12, color: "#ffb454", marginBottom: 8 }}>▲ {it.text}</div>
      ))}
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
              type="number" step="0.05" min="0" inputMode="decimal"
              placeholder={defaultShown.toFixed(2)}
              value={form.rate}
              onChange={(e) => setForm({ ...form, rate: e.target.value })}
              style={{ ...S.fInput, flex: 1 }}
            />
            <span style={{ fontSize: 12, color: dim, width: 84 }}>{rateUnit}</span>
          </div>
          <div style={{ fontSize: 11, color: dim, marginBottom: rateCheck.level === "ok" ? 10 : 4 }}>
            {form.rate === "" ? `default ${defaultShown.toFixed(2)} ${rateUnit} · ` : ""}{rateHint}
          </div>
          {rateCheck.level !== "ok" && (
            <div style={{ fontSize: 12, color: rateCheck.level === "block" ? "#ff5d7a" : PHASE_COLORS.deficit, marginBottom: 10 }}>
              {rateCheck.level === "block" ? `⚠ ${rateCheck.message} — lower it to save` : `⚠ ${rateCheck.message}`}
            </div>
          )}
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
  onCopyPrev,
  canCopyPrev,
  copyPrevLabel,
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
                  style={{ ...S.slotMenuItem, opacity: canCopyPrev ? 1 : 0.4 }}
                  disabled={!canCopyPrev}
                  onClick={() => {
                    setMenuOpen(false);
                    onCopyPrev();
                  }}
                >
                  ⧉ copy from {copyPrevLabel}
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
            <NumInput
              type="number"
              step="0.25"
              value={e.qty}
              onChange={(ev) => onQty(ei, parseFloat(ev.target.value) || 0)}
              style={S.qty}
            />
            <EntryText unit={food.unit}>
              {food.name}
              {food.verify && <span style={S.verifyDot} title="verify macros">●</span>}
              {food.type === "recipe" && <span style={S.recipeTag}>recipe</span>}
            </EntryText>
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
// A number box you can clear while typing. The parent's handlers turn an
// empty box into 0 (or 1) right away, which made a 0 impossible to delete;
// this shows what you type until you leave the box, and selects its
// contents on tap so typing replaces the old number.
function NumInput({ value, onChange, onFocus, onBlur, ...rest }) {
  const [text, setText] = useState(null); // null = not editing: show value
  const justFocused = useRef(false); // the value at focus, until the tap is released
  const selectAll = (el) => { try { el.select(); } catch { /* not selectable */ } };
  return (
    <input
      type="number"
      inputMode="decimal"
      {...rest}
      value={text ?? value ?? ""}
      placeholder={rest.placeholder ?? (Number(value) === 0 ? "0" : undefined)}
      onFocus={(e) => {
        // a 0 is cleared on focus (shown as a grey placeholder), so typing
        // "5" gives 5, not "05": iOS Safari ignores select() on number
        // inputs, which is what replaced it elsewhere. Leaving it empty
        // reads as 0 again.
        const start = Number(value) === 0 && value !== "" && value != null ? "" : String(value ?? "");
        setText(start);
        justFocused.current = start;
        const el = e.target;
        selectAll(el);
        // re-select once the tap settles, unless typing has already begun
        // (a late select would grab the first digit and the next would replace it)
        setTimeout(() => { if (el.value === start) selectAll(el); }, 0);
        onFocus?.(e);
      }}
      // the tap's release would drop the cursor at the end, undoing the select
      onMouseUp={(e) => {
        if (justFocused.current !== false && e.target.value === justFocused.current) { e.preventDefault(); selectAll(e.target); }
        justFocused.current = false;
      }}
      onChange={(e) => { setText(e.target.value); onChange(e); }}
      onBlur={(e) => { setText(null); onBlur?.(e); }}
    />
  );
}

// a food row's name with its unit underneath, so a long unit ("2 Clementines
// (168g)") gets the row's full width instead of spilling into the name
function EntryText({ unit, children }) {
  return (
    <span style={S.entryText}>
      <span style={S.entryName}>{children}</span>
      {unit && <span style={S.entryUnit}>{unit}</span>}
    </span>
  );
}

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
      <EntryText unit={row.unit}>
        {row.food_name}
        {row.source === "quick" && <span style={S.recipeTag}>quick</span>}
      </EntryText>
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
                {foods.length === 0 ? "no foods yet" : "no match"}
                {onCreateFood && (
                  <div style={{ marginTop: 10 }}>
                    <button style={S.quickAddRow} onClick={startAdd}>
                      {foods.length === 0 ? "+ add your first food" : "+ add it as a new food"}
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
                  <NumInput
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
                    <NumInput
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
              <NumInput
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

      {foods.length === 0 && (
        <div style={S.empty}>
          no foods yet — add your first with <strong>+ component</strong> (a single food) or{" "}
          <strong>+ recipe</strong> (a combination), or scan a barcode from the Plan tab.
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
                <NumInput
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
                    <NumInput
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
                    <NumInput
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
                    <EntryText unit={base ? base.unit : "?"}>
                      {base ? base.name : "(deleted food)"}
                    </EntryText>
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
// setup: during onboarding, prefilled from the calculator's weight (owner's design, Nov 2026)
function BodyweightModal({ onSave, onSkip, initial = null, setup = false }) {
  const [val, setVal] = useState(initial != null ? String(initial) : "");
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
          {setup && <div style={{ fontSize: 10, letterSpacing: 2, color: dim, fontWeight: 700, marginBottom: 14, textAlign: "left" }}>SETUP · STEP 4 / 4</div>}
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
          {setup && initial != null && String(val) === String(initial) && <div style={{ ...S.calcHint, marginTop: -4, marginBottom: 12 }}>from the calculator · change it if it isn't this morning's weight</div>}
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
          {setup && <p style={{ ...S.note, fontSize: 12, margin: "10px 0 0" }}>Skip any day. 4 or more a week keeps your trend ready.</p>}
        </div>
      </div>
    </div>
  );
}

// Past and current diet phase blocks, newest first. Back-to-back phases of
// the same type are one block (same rule the volume math uses). Each shows
// its calories vs Maintenance and the training volume impact it had
// reached by its last day (or today, for the current one).
function PhaseHistory({ dietPhases, bwLog, presets, targetHistory }) {
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
    b.cals = phaseCalories(lastRow, presetsAsOf(presets, targetHistory, b.end), null); // targets as of the block's last day
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

// "Changed Oct 8 · was 2,352 kcal · 155P 52F 316C" under a preset, newest
// change first; nothing while the preset still has its starting values
function TargetChanges({ rows }) {
  const changes = rows.filter((r) => r.effective_date !== BASELINE_DATE)
    .sort((a, b) => (a.effective_date < b.effective_date ? 1 : -1));
  if (!changes.length) return null;
  const all = [...rows].sort((a, b) => (a.effective_date < b.effective_date ? -1 : 1));
  const fmt = (iso) => parseISO(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <div style={S.tcBox}>
      {changes.slice(0, 3).map((ch) => {
        const i = all.findIndex((r) => r.effective_date === ch.effective_date);
        const was = all[i - 1];
        return (
          <div key={ch.effective_date}>
            Changed {fmt(ch.effective_date)}
            {was ? ` · was ${Math.round(Number(was.cal)).toLocaleString()} kcal · ${r0(was.p)}P ${r0(was.f)}F ${r0(was.c)}C` : ""}
          </div>
        );
      })}
      <div style={{ opacity: 0.8, marginTop: 2 }}>Past days in Plan keep the targets they had at the time.</div>
    </div>
  );
}

// "Calculate my targets": a short profile -> a starting maintenance -> every
// phase preset's targets, shown for review before anything is saved.
// setupType: during onboarding setup, the phase they picked ("maintenance",
// "surplus" or "deficit"): no close button, and the results lead with that
// phase's targets (owner's design, Nov 2026).
function TargetsCalculator({ presets, bwLog, profile, training, onApply, onClose, setupType = null }) {
  // Prefilled only from a block that's running: with none, lifting days are
  // left for you to enter rather than assumed from the last block.
  const liftDaysFromRR = training?.active ? training.daysPerWeek : null;
  const latest = (bwLog || []).length ? Number(bwLog[bwLog.length - 1].weight) : null;
  const pr = profile || {};
  const [f, setF] = useState({
    sex: pr.sex || "", age: pr.age ?? "", ft: pr.height_in ? Math.floor(pr.height_in / 12) : "", inch: pr.height_in ? pr.height_in % 12 : "",
    weight: latest ?? pr.weight_lb ?? "", bf: pr.body_fat_pct ?? "", movement: pr.movement || "",
    lift: pr.lift_days ?? liftDaysFromRR ?? "",
  });
  const [step, setStep] = useState("form");
  const [chosen, setChosen] = useState(() => new Set(presets.filter((p) => isPhaseType(p.phase_type) || p.phase_type === "day").map((p) => p.id)));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setErr(""); };
  const num = (v) => (v === "" || v == null ? NaN : Number(v));
  const heightIn = num(f.ft) * 12 + (num(f.inch) || 0);
  const liftFromRR = liftDaysFromRR != null && String(f.lift) === String(liftDaysFromRR) && pr.lift_days == null;

  const est = (() => {
    if (!f.sex || !f.movement || f.lift === "" || !(num(f.age) >= 14) || !(heightIn > 36) || !(num(f.weight) > 60)) return null;
    return estimateMaintenance({ sex: f.sex, age: num(f.age), heightIn, weightLb: num(f.weight), bodyFatPct: num(f.bf) || 0, movement: f.movement, liftDays: num(f.lift) });
  })();
  const usable = presets.filter((p) => isPhaseType(p.phase_type) || p.phase_type === "day");
  const proposed = est ? Object.fromEntries(usable.map((p) => [p.id, targetsFromMaintenance(p, est.total, num(f.weight))])) : {};

  const next = () => {
    if (!est) return setErr("Fill in sex, age, height, weight, how much you move, and lifting days.");
    setStep("review");
  };
  const apply = async () => {
    setBusy(true);
    await onApply(
      Object.fromEntries([...chosen].filter((id) => proposed[id]).map((id) => [id, proposed[id]])),
      { sex: f.sex, age: num(f.age), height_in: heightIn, weight_lb: num(f.weight), body_fat_pct: num(f.bf) || null, movement: f.movement, lift_days: num(f.lift) }
    );
    setBusy(false);
  };
  const opt = (on) => ({ ...S.ghostBtn, flex: 1, ...(on ? { color: accent, borderColor: accent } : {}) });

  return (
    <div style={S.modalWrap} onClick={setupType ? undefined : onClose}>
      <div style={{ ...S.modal, maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          <strong style={{ fontSize: 13, letterSpacing: 1 }}>
            {setupType ? <span style={{ color: dim, fontWeight: 700, fontSize: 10, letterSpacing: 2, display: "block", marginBottom: 4 }}>SETUP · STEP {step === "form" ? 2 : 3} / 4</span> : null}
            {step === "form" ? "CALCULATE MY TARGETS" : "YOUR STARTING TARGETS"}
          </strong>
          {!setupType && <button style={S.xBtn} onClick={onClose}>✕</button>}
        </div>
        {step === "form" ? (
          <div style={S.editorBody}>
            <label style={S.fLabel}>Sex</label>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={opt(f.sex === "male")} onClick={() => set("sex", "male")}>Male</button>
              <button style={opt(f.sex === "female")} onClick={() => set("sex", "female")}>Female</button>
            </div>
            <div style={S.fRow}>
              <div style={{ flex: 1 }}><label style={S.fLabel}>Age</label><NumInput value={f.age} onChange={(e) => set("age", e.target.value)} inputMode="numeric" style={S.fInput} /></div>
              <div style={{ flex: 1 }}><label style={S.fLabel}>Height (ft)</label><NumInput value={f.ft} onChange={(e) => set("ft", e.target.value)} inputMode="numeric" style={S.fInput} /></div>
              <div style={{ flex: 1 }}><label style={S.fLabel}>(in)</label><NumInput value={f.inch} onChange={(e) => set("inch", e.target.value)} inputMode="numeric" style={S.fInput} /></div>
            </div>
            <div style={S.fRow}>
              <div style={{ flex: 1 }}>
                <label style={S.fLabel}>Weight ({WEIGHT_UNIT})</label>
                <NumInput value={f.weight} onChange={(e) => set("weight", e.target.value)} style={S.fInput} />
                {latest != null && String(f.weight) === String(latest) && <div style={S.calcHint}>from your last weigh-in</div>}
              </div>
              <div style={{ flex: 1 }}>
                <label style={S.fLabel}>Body fat % (optional)</label>
                <NumInput value={f.bf} onChange={(e) => set("bf", e.target.value)} style={S.fInput} placeholder="if you know it" />
              </div>
            </div>
            <label style={S.fLabel}>Outside the gym, how much do you move on a typical day?</label>
            {MOVEMENT_LEVELS.map((m) => (
              <button key={m.id} style={{ ...S.calcOption, ...(f.movement === m.id ? { borderColor: accent } : {}) }} onClick={() => set("movement", m.id)}>
                <b style={{ color: f.movement === m.id ? accent : text }}>{m.label}</b>: {m.desc}
              </button>
            ))}
            <label style={S.fLabel}>Lifting days per week</label>
            <div style={{ display: "flex", gap: 6 }}>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((d) => (
                <button key={d} style={{ ...opt(String(f.lift) === String(d)), padding: "8px 0" }} onClick={() => set("lift", d)}>{d}</button>
              ))}
            </div>
            {liftFromRR && <div style={S.calcHint}>from your current RepReport block</div>}
            {training && !training.active && pr.lift_days == null && (
              <div style={S.calcHint}>
                No active RepReport block — enter how often you lift right now
                {training.lastDaysPerWeek ? ` (your last block was ${training.lastDaysPerWeek} days/week)` : ""}.
              </div>
            )}
            {err && <div style={{ color: "#ff5d7a", fontSize: 12, marginTop: 8 }}>{err}</div>}
            <button style={{ ...S.primaryBtn, width: "100%", marginTop: 14 }} onClick={next}>See my targets</button>
          </div>
        ) : setupType ? (
          <SetupTargets setupType={setupType} presets={usable} proposed={proposed} est={est} busy={busy} onSave={apply} onBack={() => setStep("form")} />
        ) : (
          <div style={S.editorBody}>
            <div style={{ fontSize: 15 }}>Maintenance ≈ <b>{est.total.toLocaleString()} kcal</b></div>
            <div style={S.calcHint}>
              {est.rest.toLocaleString()} at rest ({est.method}) × your daily movement = {est.daily.toLocaleString()}
              {est.lifting ? `, + ${est.lifting} for lifting` : ""}. A starting estimate: your weekly check-ins correct it after 2–3 weeks of logging.
            </div>
            {usable.map((p) => {
              const t = proposed[p.id];
              const on = chosen.has(p.id);
              return (
                <label key={p.id} style={{ ...S.calcRow, opacity: on ? 1 : 0.5 }}>
                  <input type="checkbox" checked={on} onChange={() => setChosen((c) => { const n = new Set(c); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })} />
                  <span style={{ flex: 1 }}>
                    <b>{p.name}</b>
                    <span style={{ color: dim }}> · now {Math.round(p.target.cal).toLocaleString()}{p.example ? " (example)" : ""}</span>
                  </span>
                  <span>{t.cal.toLocaleString()} kcal · {t.p}P {t.f}F {t.c}C</span>
                </label>
              );
            })}
            <div style={S.calcHint}>Protein about 0.9 g per pound on a cut, 0.7 g per pound otherwise; fat 20–25% of calories; carbs the rest. Untick any you want to keep as they are.</div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button style={{ ...S.primaryBtn, flex: 2 }} disabled={busy || !chosen.size} onClick={apply}>Save these targets</button>
              <button style={{ ...S.ghostBtn, flex: 1 }} onClick={() => setStep("form")}>back</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// The preset a setup choice starts: maintenance, the (non-mini) cut, or the bulk.
function presetForType(presets, type) {
  if (type === "maintenance") return maintenancePreset(presets);
  return (presets || []).find((p) => p.phase_type === type && !isMiniCut(p.phase_type, p.name)) || null;
}

// Setup step 3: the targets they'll actually use, from the phase they picked.
// The other targets (bulk, cut, mini-cut, refeed) are set too, and introduced
// later, the first time they plan a phase.
function SetupTargets({ setupType, presets, proposed, est, busy, onSave, onBack }) {
  const p = presetForType(presets, setupType);
  const t = p ? proposed[p.id] : null;
  const name = { maintenance: "maintenance", surplus: "a bulk", deficit: "a cut" }[setupType];
  return (
    <div style={S.editorBody}>
      <div style={{ fontSize: 13, color: dim, marginBottom: 12 }}>
        For <span style={{ color: PHASE_COLORS[setupType], fontWeight: 700 }}>{name}</span>, every day
      </div>
      {t && (
        <div style={{ ...S.dash, margin: 0, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
            <span style={{ fontFamily: "'Archivo',sans-serif", fontWeight: 800, fontSize: 34, color: text }}>{t.cal.toLocaleString()}</span>
            <span style={{ color: dim, fontSize: 14 }}>kcal a day</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {[["Protein", t.p, "#46e6a0"], ["Fat", t.f, "#ffb454"], ["Carbs", t.c, "#5db4ff"]].map(([l, g, c]) => (
              <div key={l} style={{ flex: 1, border: `1px solid ${line}`, borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ fontSize: 11, color: dim }}>{l}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: c }}>{g} g</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ ...S.calcHint, marginTop: 8 }}>
        Your maintenance is about {est.total.toLocaleString()} kcal: a starting estimate from your answers. Your weekly check-ins correct it from what you log.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button style={{ ...S.primaryBtn, flex: 2 }} disabled={busy} onClick={onSave}>{busy ? "saving…" : "SAVE MY TARGETS →"}</button>
        <button style={{ ...S.ghostBtn, flex: 1 }} onClick={onBack}>back</button>
      </div>
    </div>
  );
}

/* ============================================================
   ONBOARDING — tour, setup and one-time tips (owner's design, Nov 2026;
   docs/proposals/onboarding.md in RepReport). Flags live on the account's
   user_metadata (mealprep_onboarding), so they follow the account across
   devices; accounts that already had data are marked as having seen it all.
   ============================================================ */
const ONBOARDING_ALL_SEEN = {
  v: 1, tour: true, setup: true,
  tips: { checkin: true, copyMeal: true, pace: true, firstTargets: true, planPhase: true, cut: true },
  banners: { pace: true, maintenance: true },
};
const PACE_HINT = "Starts at Meal Prep's default pace. Already have a pace in mind? Change it on the calendar";

// One-time tip overlay: the frame RepReport's TipSequence uses, in Meal Prep's colors.
function TipCard({ kicker = "HOW IT WORKS", title, caption, body, children, button = "GOT IT", onDone, step = null, total = null, onSkip = null }) {
  return (
    <div style={{ ...S.modalWrap, zIndex: 60 }}>
      <div style={{ ...S.modal, maxWidth: 380, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, letterSpacing: 2, color: dim, fontWeight: 700, marginBottom: 16 }}>
            <span>{step ? `STEP ${step} / ${total}` : kicker}</span>
            {onSkip && <button style={{ background: "none", border: "none", color: dim, fontSize: 10, letterSpacing: 2, fontWeight: 700, cursor: "pointer", padding: 0 }} onClick={onSkip}>SKIP</button>}
          </div>
          <div style={{ fontFamily: "'Archivo',sans-serif", fontWeight: 800, fontSize: 22, lineHeight: 1.15, color: text, marginBottom: 14 }}>{title}</div>
          {children && <div style={{ pointerEvents: "none" }}>{children}</div>}
          {caption && <div style={{ ...S.calcHint, marginTop: 8 }}>{caption}</div>}
          {body && <p style={{ color: text, fontSize: 14, lineHeight: 1.55, margin: "14px 0 0" }}>{body}</p>}
          {step && (
            <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 20 }}>
              {Array.from({ length: total }, (_, i) => (
                <div key={i} style={{ height: 4, borderRadius: 4, width: i === step - 1 ? 22 : 6, background: i === step - 1 ? accent : line }} />
              ))}
            </div>
          )}
          <button style={{ ...S.primaryBtn, width: "100%", marginTop: 18 }} onClick={onDone}>{button}</button>
        </div>
      </div>
    </div>
  );
}

// a looping two-state demo: false, then true, then back
function useFlip(ms = 1800) {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setInterval(() => setOn((v) => !v), ms); return () => clearInterval(t); }, [ms]);
  return on;
}

const TOUR_TARGET = { p: 131, f: 79, c: 401, cal: 2840 }; // the calculator for 180 lb, 20 y, 5'10", some walking, 4 lifting days
const TOUR_BEFORE = { p: 40, f: 31, c: 109, cal: 875 };   // breakfast logged
const TOUR_AFTER = { p: 85, f: 40, c: 190, cal: 1460 };   // + lunch: 6 oz chicken, 1.5 cups rice (45 P, 9 F, 81 C, 585 kcal)

function TourTargetsDemo() {
  return (
    <div style={{ ...S.dash, margin: 0 }}>
      <div style={S.dashHead}><span style={S.dashLabel}>TARGETS</span><span style={{ fontSize: 13, color: text }}>Maintenance (diet phase)</span></div>
      <MacroBars total={TOUR_AFTER} target={TOUR_TARGET} />
    </div>
  );
}

function TourLogDemo() {
  const done = useFlip(2000);
  return (
    <>
      <div style={{ ...S.dash, margin: "0 0 10px" }}><MacroBars total={done ? TOUR_AFTER : TOUR_BEFORE} target={TOUR_TARGET} /></div>
      <div style={{ ...S.slot, ...(done ? S.slotLogged : {}), marginBottom: 0 }}>
        <div style={S.slotHead}>
          <span style={{ ...S.checkBtn, ...(done ? S.checkBtnOn : {}), display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{done ? "✓" : ""}</span>
          <span style={{ ...S.slotName, borderBottom: "none" }}>Lunch</span>
          <span style={S.slotMacros}>585 kcal · 45P · 9F · 81C</span>
        </div>
        {[["6", "oz", "Chicken breast", "210 · 39P"], ["1.5", "cup", "White rice", "375 · 6P"]].map(([q, u, n, m]) => (
          <div key={n} style={S.entry}>
            <span style={{ ...S.qty, display: "inline-block" }}>{q}</span>
            <EntryText unit={u}>{n}</EntryText>
            <span style={S.entryMacros}>{m}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// 14 mornings at maintenance (±0.8 lb of water around 180); the heavy morning
// is 182.0. The line is the trend Meal Prep actually fits (weightTrend).
const TOUR_WEIGHTS = [180.4, 179.4, 180.8, 179.8, 180.1, 179.2, 180.5, 179.7, 180.6, 179.5, 180.2, 179.3, 180.3];
function TourTrendDemo() {
  const heavy = useFlip(2200);
  const pts = [...TOUR_WEIGHTS, heavy ? 182.0 : 180.2];
  const today = todayISO();
  const t = weightTrend(pts.map((w, i) => ({ date: addDaysISO(today, i - 13), weight: w })), today);
  const perDay = t.ready ? ((t.pctPerWeek / 100) * t.avg) / 7 : 0;
  const fit = (i) => (t.ready ? t.avg : 180) + perDay * (i - 6.5);
  const W = 300, H = 90, lo = 178.5, hi = 182.5;
  const x = (i) => 10 + i * ((W - 20) / 13), y = (w) => H - 8 - ((w - lo) / (hi - lo)) * (H - 16);
  const row = (k, v, sub) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "7px 0", borderTop: `1px solid ${line}` }}>
      <span style={{ fontSize: 12, color: dim }}>{k}</span>
      <span style={{ fontSize: 14, color: text, fontWeight: 600 }}>{v}{sub && <span style={{ color: dim, fontWeight: 400 }}> {sub}</span>}</span>
    </div>
  );
  return (
    <div style={{ ...S.dash, margin: 0, padding: "12px 14px" }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        <line x1={x(0)} x2={x(13)} y1={y(fit(0))} y2={y(fit(13))} stroke={PHASE_COLORS.maintenance} strokeWidth="2" strokeDasharray="5 4" opacity="0.8" />
        {pts.map((w, i) => <circle key={i} cx={x(i)} cy={y(w)} r={i === 13 ? 5 : 3.5} fill={i === 13 ? "#ffb454" : dim} />)}
      </svg>
      {row("Today's weigh-in", heavy ? "182.0 lb" : "180.2 lb", heavy ? "(+1.7 overnight)" : "")}
      {row("Trend, last 2 weeks", "Holding steady")}
      {row("Your targets", "2,840 kcal", "· no change")}
    </div>
  );
}

// Card 4, connected: the real goal line for their own block at each phase's default pace.
function TourGoalDemo({ goal }) {
  const PH = [
    ["Maintenance", "maintenance", { type: "maintenance", kind: "maintenance", targetPct: null, pacePct: null }],
    ["Bulk", "surplus", { type: "surplus", kind: "surplus", targetPct: 1 / WEEKS_PER_MONTH, pacePct: null }],
    ["Cut", "deficit", { type: "deficit", kind: "deficit", targetPct: -0.7, pacePct: 0.7 }],
  ];
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((n) => (n + 1) % PH.length), 2200); return () => clearInterval(t); }, []);
  const [, , phase] = PH[i];
  const line1 = goalCheck(goal, phase)?.summary;
  return (
    <div style={{ ...S.dash, margin: 0, padding: "12px 14px" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {PH.map(([n, t], k) => (
          <div key={n} style={{ flex: 1, textAlign: "center", padding: "7px 0", borderRadius: 8, fontSize: 13, fontWeight: 600,
            border: `1px solid ${k === i ? PHASE_COLORS[t] : line}`, color: k === i ? PHASE_COLORS[t] : dim }}>{n}</div>
        ))}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.5, color: text }}>{line1} <span style={{ color: dim }}>(your RepReport block)</span></div>
    </div>
  );
}

function TourSetsPicture() {
  const big = (from, to, label, color) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6 }}>
      <span style={{ fontSize: 22, fontWeight: 800, color: dim, textDecoration: "line-through" }}>{from}</span>
      <span style={{ color: dim }}>→</span>
      <span style={{ fontSize: 30, fontWeight: 800, color }}>{to}</span>
      <span style={{ fontSize: 10, letterSpacing: 1.5, color: dim, fontWeight: 700 }}>{label}</span>
    </div>
  );
  return (
    <div style={{ ...S.dash, margin: 0, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, letterSpacing: 2, color: dim, fontWeight: 700 }}>MOST CHEST SETS A WEEK</div>
      {big(20, 18, "CUT", PHASE_COLORS.deficit)}
      {big(20, 21, "BULK", PHASE_COLORS.surplus)}
    </div>
  );
}

// The 4-card tour. training: RepReport's status (null = no RepReport data).
function MealPrepTour({ training, onDone }) {
  const [step, setStep] = useState(1);
  const next = () => (step < 4 ? setStep(step + 1) : onDone());
  const common = { step, total: 4, onSkip: onDone, onDone: next, button: step < 4 ? "NEXT →" : "SET UP →" };
  if (step === 1) return (
    <TipCard {...common} title="Targets that follow the scale." caption="Example targets, partway through the day."
      body="Meal Prep sets your daily targets from a few quick questions about you and your training, then adjusts them to what your weight actually does.">
      <TourTargetsDemo />
    </TipCard>
  );
  if (step === 2) return (
    <TipCard {...common} title="Check off a meal to log it." caption="One tap logs the whole meal."
      body="Plan your usual meals once, then check each one off as you eat it. Next week, copy a meal over from its ⋮ menu.">
      <TourLogDemo />
    </TipCard>
  );
  if (step === 3) return (
    <TipCard {...common} title="Reads your trend, not one weigh-in." caption="A heavy morning: one dot jumps, the trend barely moves, and your targets stay put."
      body="Your weight bounces day to day with water and food. Meal Prep follows the trend across two weeks of weigh-ins, so one heavy morning doesn't change your plan. Weigh in most mornings, 4 or more a week.">
      <TourTrendDemo />
    </TipCard>
  );
  if (training) return (
    <TipCard {...common} title="Connected to RepReport." caption={training.goal ? "What each diet phase means for your current RepReport block." : null}
      body="Your diet phase goes to RepReport, which plans your sets around it. Meal Prep gets your lifting days, your light weeks on the calendar, and, on a cut, whether your lifts are holding up.">
      {training.goal ? <TourGoalDemo goal={training.goal} /> : null}
    </TipCard>
  );
  return (
    <TipCard {...common} title="Lift with RepReport?" caption="Chest at 180 lb: week 12 of a 12-week cut losing about 1 lb a week, or week 16 of a 16-week bulk gaining about 1.8 lb a month."
      body={<>RepReport is our training app. Sign in at <b style={{ color: accent }}>repreport.app</b> with this same email. On a cut, it adds new sets slower and lowers the most sets each muscle can get. On a bulk, it raises them. Meal Prep works fully on its own.</>}>
      <TourSetsPicture />
    </TipCard>
  );
}

// The three phase choices, shared by setup and the "What's next?" card. The
// pace hint shows under Gaining or Losing once tapped, every time.
function PhaseChoices({ options, picked, onPick, hintSuffix = " after setup." }) {
  return options.map(([t, label, sub]) => {
    const on = picked === t;
    return (
      <button key={t} onClick={() => onPick(t)}
        style={{ display: "block", width: "100%", textAlign: "left", background: on ? "rgba(255,255,255,0.03)" : "transparent", cursor: "pointer",
          border: `1px solid ${on ? PHASE_COLORS[t] : line}`, borderRadius: 10, padding: "12px 14px", marginBottom: 8, color: text, fontFamily: "inherit" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${on ? PHASE_COLORS[t] : dim}`, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {on && <span style={{ width: 8, height: 8, borderRadius: "50%", background: PHASE_COLORS[t] }} />}
          </span>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{label}</span>
          <span style={{ fontSize: 13, color: dim }}>{sub}</span>
        </div>
        {on && t !== "maintenance" && <div style={{ ...S.calcHint, marginTop: 8, marginLeft: 30, fontSize: 12 }}>{PACE_HINT}{hintSuffix}</div>}
      </button>
    );
  });
}
const SETUP_OPTIONS = [["maintenance", "Holding my weight", "maintenance"], ["surplus", "Gaining", "a bulk"], ["deficit", "Losing", "a cut"]];

// Setup step 1: required, nothing preselected, no numbers.
function SetupPhaseChoice({ onContinue }) {
  const [picked, setPicked] = useState(null);
  return (
    <div style={{ ...S.modalWrap, zIndex: 60 }}>
      <div style={{ ...S.modal, maxWidth: 380, width: "100%" }}>
        <div style={{ padding: 22 }}>
          <div style={{ fontSize: 10, letterSpacing: 2, color: dim, fontWeight: 700, marginBottom: 18 }}>SETUP · STEP 1 / 4</div>
          <div style={{ fontFamily: "'Archivo',sans-serif", fontWeight: 800, fontSize: 22, lineHeight: 1.15, color: text, marginBottom: 16 }}>What are you doing right now?</div>
          <PhaseChoices options={SETUP_OPTIONS} picked={picked} onPick={setPicked} />
          <p style={{ ...S.note, fontSize: 12, margin: "14px 0 0" }}>
            You can change the pace and length any time on the calendar. Cutting is optional. Meal Prep is not medical advice. If you have a history of disordered eating, talk to a professional before changing how you eat.
          </p>
          <button style={{ ...S.primaryBtn, width: "100%", marginTop: 18, opacity: picked ? 1 : 0.4 }} disabled={!picked} onClick={() => onContinue(picked)}>CONTINUE →</button>
        </div>
      </div>
    </div>
  );
}

// After setup's targets: what to expect, then the first weigh-in. The pace
// line follows their phase: about 2 weeks at maintenance, 3 on a cut (day
// 20), 4 on a bulk (its monthly trend).
function SetupWhatsNext({ phaseType, onContinue }) {
  const paceWhen = phaseType === "deficit" ? "In about 3 weeks" : phaseType === "surplus" ? "In about 4 weeks" : "In about 2 weeks";
  const stops = [
    ["Today", "Your starting targets"],
    ["Every Monday", "A quick check-in: tick the days you fully logged"],
    [paceWhen, "Your pace, from your weigh-ins"],
    ["In 2–3 weeks", "Your real maintenance, and your first suggested targets"],
  ];
  return (
    <div style={{ ...S.modalWrap, zIndex: 60 }}>
      <div style={{ ...S.modal, maxWidth: 380, width: "100%" }}>
        <div style={{ padding: 22 }}>
          <div style={{ fontSize: 10, letterSpacing: 2, color: dim, fontWeight: 700, marginBottom: 18 }}>ALMOST DONE</div>
          <div style={{ fontFamily: "'Archivo',sans-serif", fontWeight: 800, fontSize: 22, color: text, marginBottom: 16 }}>What comes next</div>
          <div style={{ ...S.dash, margin: 0, padding: "14px 14px 4px" }}>
            {stops.map(([when, what], i) => (
              <div key={when + i} style={{ display: "flex", gap: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span style={{ width: 12, height: 12, borderRadius: "50%", marginTop: 3, background: i === 0 ? accent : "transparent", border: `2px solid ${i === 0 ? accent : dim}` }} />
                  {i < stops.length - 1 && <span style={{ flex: 1, width: 2, background: line, margin: "3px 0" }} />}
                </div>
                <div style={{ paddingBottom: 14 }}>
                  <div style={{ fontSize: 10, letterSpacing: 1.5, color: i === 0 ? accent : dim, fontWeight: 700 }}>{when.toUpperCase()}</div>
                  <div style={{ fontSize: 14, color: text, marginTop: 2, lineHeight: 1.4 }}>{what}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ ...S.calcHint, marginTop: 8 }}>If you log and weigh in most days.</div>
          <p style={{ color: text, fontSize: 14, lineHeight: 1.55, margin: "14px 0 0" }}>
            Calorie formulas can be off by a couple hundred calories a day. Meal Prep learns what you actually burn from your food logs and weigh-ins, and sets your targets from that.
          </p>
          <button style={{ ...S.primaryBtn, width: "100%", marginTop: 18 }} onClick={onContinue}>LOG TODAY'S WEIGH-IN →</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- onboarding: later moments ---------- */
// The pace the phase card shows today, or { ready: false }. Same trend and
// waiting rule as the card (paceStartsOn).
function paceReading(rows, bwLog, today) {
  const phase = phaseOnDate(rows, today);
  if (!phase) return { ready: false };
  const monthly = rateIsMonthly(phase.phase_type);
  const from = paceStartsOn(rows, phase, monthly);
  if (from && today < from) return { ready: false, phase };
  const t = monthly ? monthlyWeightTrend(bwLog, today) : weightTrend(bwLog, today);
  if (!t.ready) return { ready: false, phase };
  const weighIns = (bwLog || []).filter((r) => r.date > addDaysISO(today, -14) && r.date <= today).length;
  return { ready: true, phase, monthly, pctPerWeek: monthly ? t.pctPerMonth / WEEKS_PER_MONTH : t.pctPerWeek, avg: t.avg, weighIns };
}

// "about 1¼ lb a week"
function lbPerWeekText(lb) {
  if (lb < 0.25) return "less than ¼ lb a week";
  const q = Math.round(lb * 4), whole = Math.floor(q / 4), frac = ["", "¼", "½", "¾"][q % 4];
  return `about ${whole ? whole : ""}${frac || (whole ? "" : "0")} lb a week`;
}

// The pace tip's first sentence, from their own trend: leads with what's going
// right; off target, it states the facts and points to the check-in.
function paceSentence(type, pctPerWeek, weight, targetPctPerWeek) {
  const lb = Math.abs((pctPerWeek / 100) * weight), dir = pctPerWeek < 0 ? "losing" : "gaining";
  if (type === "maintenance") {
    if (Math.abs(pctPerWeek) <= 0.25) return lb < 0.25
      ? `You're holding your weight steady, right on your maintenance goal: it's moved ${lbPerWeekText(lb)}.`
      : "You're holding your weight steady, right on your maintenance goal.";
    return `You're ${dir} ${lbPerWeekText(lb)} at maintenance. Your next check-in will suggest targets to hold you steady.${pctPerWeek > 0 ? " If you meant to bulk, switch your phase on the calendar." : " If you meant to cut, switch your phase on the calendar."}`;
  }
  const losing = type === "deficit";
  const tol = losing ? 0.2 : 0.25 / WEEKS_PER_MONTH;
  if (Math.abs(pctPerWeek - targetPctPerWeek) <= tol) return `You're right on your ${losing ? "cut" : "bulk"}'s target: ${dir} ${lbPerWeekText(lb)}.`;
  if (losing ? pctPerWeek >= 0 : pctPerWeek <= 0) return `Your weight hasn't ${losing ? "dropped" : "risen"} yet. Your next check-in will suggest new targets from it.`;
  const slower = Math.abs(pctPerWeek) < Math.abs(targetPctPerWeek);
  return `You're ${dir} ${lbPerWeekText(lb)}, ${slower ? "slower" : "faster"} than your target of ${lbPerWeekText(Math.abs((targetPctPerWeek / 100) * weight))}. Your next check-in will suggest new targets from it.`;
}

// The day their planned phases run out: maintenance past the end of its plan
// with nothing after it ("plan"), or the maintenance a mini-cut switched them
// to ("minicut", with the days left to continue the bulk as the same bulk).
function planDoneInfo(rows, today) {
  const cur = phaseOnDate(rows, today);
  if (!cur || cur.phase_type !== "maintenance") return null;
  if ((rows || []).some((r) => r.start_date > today)) return null;
  const sorted = [...rows].sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const prev = sorted[sorted.indexOf(cur) - 1] || null;
  if (prev && isMiniCut(prev.phase_type, prev.phase_name) && !cur.planned_end_date) {
    // the bulk before the mini-cut continues if restarted within its fade
    // window (2–4 weeks by the bulk's length), counting maintenance before and
    // after the mini-cut (chainGap in dietPhaseContext)
    const i = sorted.indexOf(prev);
    const lastBulk = sorted.slice(0, i).reverse().find((r) => r.phase_type === "surplus") || null;
    let windowDays = null;
    if (lastBulk) {
      const after = sorted[sorted.indexOf(lastBulk) + 1];
      const bulkEnd = lastBulk.end_date || addDaysISO(after.start_date, -1);
      const bulk = precedingBlock(rows, addDaysISO(bulkEnd, 1));
      if (bulk && bulk.type === "surplus") {
        const before = Math.max(0, daysBetween(bulkEnd, prev.start_date) - 1);
        windowDays = bulkMaintenanceWeeks(bulk.weeks) * 7 - before - daysBetween(cur.start_date, today);
      }
    }
    return { kind: "minicut", key: `${cur.id}`, prevType: prev.phase_type, miniWeeks: phaseProgress(prev, prev.planned_end_date || cur.start_date).plannedWeeks, windowDays };
  }
  if (cur.planned_end_date && today > cur.planned_end_date && prev && prev.phase_type !== "maintenance") {
    return { kind: "plan", key: `${cur.id}:${cur.planned_end_date}`, prevType: prev.phase_type };
  }
  return null;
}

const continueWindowText = (days) => (days >= 14 ? `${Math.floor(days / 7)} weeks` : `${days} day${days === 1 ? "" : "s"}`);

function UnlockedBanner({ title, sub, dots = 0, onSee, onClose }) {
  return (
    <div style={{ border: `1px solid ${accent}`, borderRadius: 12, padding: 14, marginBottom: 14, background: "linear-gradient(135deg, rgba(70,230,160,0.14), rgba(70,230,160,0.02))" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, letterSpacing: 1.5, color: accent, fontWeight: 800 }}>✓ UNLOCKED</span>
        <button style={{ background: "none", border: "none", color: dim, fontSize: 16, cursor: "pointer" }} onClick={onClose} aria-label="dismiss">✕</button>
      </div>
      <div style={{ fontFamily: "'Archivo',sans-serif", fontWeight: 800, fontSize: 20, color: text, marginTop: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: dim, marginTop: 4, lineHeight: 1.45 }}>{sub}</div>
      {dots > 0 && (
        <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
          {Array.from({ length: Math.min(dots, 21) }, (_, i) => <span key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: accent, opacity: 0.35 + (0.65 * (i + 1)) / Math.min(dots, 21) }} />)}
        </div>
      )}
      <button style={{ ...S.primaryBtn, width: "100%", marginTop: 12 }} onClick={onSee}>SEE IT →</button>
    </div>
  );
}

const MINICUT_OPTIONS = [["maintenance", "Holding my weight", "stay at maintenance"], ["surplus", "Gaining", "back to a bulk"]];
const PLAN_OPTIONS = [["maintenance", "Holding my weight", "stay at maintenance"], ["surplus", "Gaining", "a bulk"], ["deficit", "Losing", "a cut"]];

// "What's next?" on the Plan screen when their planned phases run out.
function WhatsNextCard({ info, baselineNote, onPick, onLater }) {
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const mini = info.kind === "minicut";
  return (
    <div style={{ border: `1px solid ${accent}`, borderRadius: 12, padding: 14, marginBottom: 14, background: "rgba(70,230,160,0.05)" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, letterSpacing: 1.5, color: accent, fontWeight: 800 }}>WHAT'S NEXT?</span>
        <button style={{ background: "none", border: "none", color: dim, fontSize: 13, cursor: "pointer" }} onClick={onLater}>later</button>
      </div>
      <div style={{ fontFamily: "'Archivo',sans-serif", fontWeight: 800, fontSize: 19, color: text, marginTop: 6 }}>
        {mini ? `Your mini-cut's planned ${info.miniWeeks || 4} weeks are up. What's next?` : "Your plan is done. What's next?"}
      </div>
      <div style={{ fontSize: 13, color: dim, marginTop: 4, marginBottom: 12, lineHeight: 1.45 }}>
        {mini
          ? <>Nothing was planned after it, so Meal Prep switched you to maintenance until you pick your next phase.{info.windowDays > 0 ? ` Continue your bulk within ${continueWindowText(info.windowDays)} to pick up where it left off.` : ""}</>
          : "Meal Prep is keeping you at maintenance until you pick your next phase."}
      </div>
      {baselineNote && (
        <div style={{ border: `1px solid ${REPREPORT_AMBER}`, borderRadius: 8, padding: "8px 10px", marginBottom: 12, background: "rgba(251,191,36,0.07)" }}>
          <div style={{ fontSize: 10, letterSpacing: 1.8, fontWeight: 800, color: REPREPORT_AMBER }}>⇄ FROM REPREPORT</div>
          <div style={{ fontSize: 13, color: text, marginTop: 4, lineHeight: 1.45 }}>{baselineNote}</div>
        </div>
      )}
      <PhaseChoices options={mini ? MINICUT_OPTIONS : PLAN_OPTIONS} picked={picked} onPick={setPicked} hintSuffix="." />
      {!mini && <div style={{ fontSize: 12, color: dim, marginTop: 4 }}>Cutting is optional.</div>}
      <button style={{ ...S.primaryBtn, width: "100%", marginTop: 8, opacity: picked ? 1 : 0.4 }} disabled={!picked || busy}
        onClick={async () => { setBusy(true); await onPick(picked); setBusy(false); }}>{busy ? "saving…" : "CONTINUE →"}</button>
    </div>
  );
}

// tip pictures
function CheckinTicksDemo() {
  const days = [["Sun", "2,790", true], ["Sat", "1,150", false], ["Fri", "2,910", true]];
  return (
    <div style={S.ciCard}>
      <div style={S.ciKicker}>WEEKLY CHECK-IN</div>
      <div style={S.ciStep}>Which days last week were fully logged?</div>
      {days.map(([d, k, on]) => (
        <div key={d} style={S.ciDay}><input type="checkbox" readOnly checked={on} /><span style={{ flex: 1, color: on ? text : dim }}>{d}</span><span style={{ color: dim }}>{k} kcal</span></div>
      ))}
    </div>
  );
}

function FirstTargetsDemo({ c }) {
  return (
    <div style={S.ciCard}>
      <div style={S.ciKicker}>WEEKLY CHECK-IN</div>
      <div style={S.ciLine}>Maintenance ≈ <b>{Math.round(c.estimate).toLocaleString()} kcal</b>
        {c.prior != null && <div style={S.ciSub}>From your log and weigh-ins (your starting estimate was {Math.round(c.prior).toLocaleString()}).</div>}</div>
      <div style={S.ciStep}>Suggested daily calories</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 18, color: dim, textDecoration: "line-through" }}>{Math.round(c.followed.target.cal).toLocaleString()}</span>
        <span style={{ color: dim }}>→</span>
        <span style={{ fontSize: 28, fontWeight: 800, color: text }}>{c.suggestion.cal.toLocaleString()}</span>
        <span style={{ fontSize: 13, color: dim }}>kcal a day</span>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <span style={{ ...S.primaryBtn, flex: 1, textAlign: "center" }}>Apply</span>
        <span style={{ ...S.ghostBtn, flex: 1, textAlign: "center" }}>Adjust</span>
        <span style={{ ...S.ghostBtn, flex: 1, textAlign: "center" }}>Keep current</span>
      </div>
    </div>
  );
}

// "Your cut": what changes (a summary, not the phase card), then one line
// that depends on RepReport.
function CutSummary({ cut, maint, ratePct, training }) {
  const stat = (l, n, sub) => (<div><div style={S.pcStatL}>{l}</div><div style={S.pcStatN}>{n}</div><div style={{ ...S.pcStatSub, color: dim }}>{sub}</div></div>);
  return (
    <div style={{ ...S.pcCard, borderLeft: `4px solid ${PHASE_COLORS.deficit}`, marginBottom: 0 }}>
      <div style={S.pcKicker}>WHAT CHANGES</div>
      <div style={{ ...S.pcName, color: PHASE_COLORS.deficit }}>CUT · WEEK 1</div>
      <div style={S.pcStats}>
        {stat("Calories", Math.round(cut.target.cal).toLocaleString(), maint ? `was ${Math.round(maint.target.cal).toLocaleString()}` : "")}
        {stat("Protein", `${Math.round(cut.target.p)} g`, maint ? `was ${Math.round(maint.target.p)} g` : "")}
        {stat("Target pace", `−${Math.abs(ratePct).toFixed(1)}%`, "a week")}
      </div>
      {!training ? (
        <div style={S.stBox}><div style={S.stHead}>Lifting during this cut?</div>
          <div style={S.viNote}>RepReport plans your sets around it and shows whether your lifts are holding up, the clearest sign you're keeping muscle. Sign in at <b style={{ color: accent }}>repreport.app</b> with this same email.</div></div>
      ) : !training.active ? (
        <div style={{ ...S.viNote, color: text, marginTop: 12 }}>No active RepReport block. Start one so your sets follow this cut and RepReport can check that your lifts hold up.</div>
      ) : (
        <div style={S.stBox}><div style={S.stHead}>Strength (from RepReport)</div><div style={S.viNote}>Strength since the cut began: not enough sessions yet to compare.</div></div>
      )}
    </div>
  );
}

// the copy-meal tip's picture: a meal's ⋮ menu, open
function CopyMenuPicture() {
  const item = { padding: "8px 12px", fontSize: 13, color: text, borderTop: `1px solid ${line}` };
  return (
    <div style={{ ...S.dash, margin: 0, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginBottom: 8 }}>
        <span>Lunch</span><span style={{ color: dim }}>⋮</span>
      </div>
      <div style={{ border: `1px solid ${line}`, borderRadius: 8, overflow: "hidden", marginLeft: "auto", width: "75%" }}>
        <div style={{ ...item, borderTop: "none", color: dim }}>⧉ copy to next day</div>
        <div style={{ ...item, color: accent, fontWeight: 700 }}>⧉ copy from last week</div>
        <div style={{ ...item, color: "#ff5d7a", opacity: 0.6 }}>✕ delete meal</div>
      </div>
    </div>
  );
}

// the calendar's first-open tip, inside the sheet above the real calendar
function PlanPhaseTip({ block, onDone }) {
  return (
    <div style={{ border: `1px solid ${accent}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
      <div style={{ fontSize: 10, letterSpacing: 2, color: dim, fontWeight: 700, marginBottom: 6 }}>HOW IT WORKS</div>
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Plan your next phase</div>
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
        Plan your cuts, bulks and maintenance ahead of time{block ? ", lined up with your training" : ""}. To plan one, tap "edit phases", the day it should start, then "new phase here".
      </div>
      {block && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: REPREPORT_AMBER + "14", fontSize: 12, lineHeight: 1.5 }}>
          <div style={{ color: REPREPORT_AMBER, fontWeight: 800, letterSpacing: 1, fontSize: 10, marginBottom: 2 }}>⇄ FROM REPREPORT · synced</div>
          Your current block runs {shortDate(block.start)} – {shortDate(block.end)}{block.deloadStart ? `, light week (deload) from ${shortDate(block.deloadStart)}` : ""}. It's marked below.
        </div>
      )}
      <button style={{ ...S.primaryBtn, width: "100%", marginTop: 10 }} onClick={onDone}>GOT IT</button>
    </div>
  );
}


/* ---------- the Phases tab ----------
   The phase in effect, the maintenance estimate behind every target, and
   each saved target as a card: its goal rate, the calories that rate gives
   at the current estimate, and its macros. "View & edit" opens
   TargetEditor: the rate is edited, calories are calculated from it
   (read-only), and macros balance inside the calories (balanceMacros). */
const fmtK = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
const signPct = (n, d = 2) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}%`;
// differences under this are rounding and weight drift that the next check-in absorbs, not worth a line
const TARGET_GAP_SHOWN_KCAL = 50;

// "−0.50% / week", "+1.00% / month", "Hold" for a weekly rate on a phase type
function rateLabel(type, ratePctPerWeek) {
  if (type === "maintenance") return "Hold";
  const monthly = rateIsMonthly(type);
  return `${signPct(monthly ? ratePctPerWeek * WEEKS_PER_MONTH : ratePctPerWeek)} / ${monthly ? "month" : "week"}`;
}
const ESTIMATE_SOURCE = {
  learned: "from your logged food and weigh-ins",
  adjusted: "your own number, from a check-in Edit",
  starting: "a starting estimate (your Maintenance target), until your data takes over",
};

// What a preset's card shows. The phase in effect (row) uses that phase's
// own rate; a preset not in effect, its default rate. calculated: the
// calories that rate gives at the recorded estimate (null without one).
function presetView(p, { basis, weightLb, row, dietPhases, today, holdRatePct = 0 }) {
  const active = !!row && row.phase_id === p.id;
  const kind = p.phase_type === "day" ? "day" : isPhaseType(p.phase_type) ? p.phase_type : null;
  // maintenance in effect: 0, or the pace winning back a drift (maintenanceHold)
  const ratePct = kind === "day" || !kind ? null : active ? (row.phase_type === "maintenance" ? holdRatePct || 0 : phaseRatePct(row)) : presetRatePct(p);
  const calculated = kind && kind !== "day" ? phaseCalTarget(basis?.kcal ?? null, ratePct, weightLb) : null;
  const saved = Number(p.target.cal) || 0;
  const gap = calculated != null ? saved - calculated : null;
  const planned = (dietPhases || []).filter((r) => r.phase_id === p.id && r.start_date > today)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const check = checkMacros(p.target, saved, { phaseType: kind === "day" ? null : kind, weightLb });
  return { active, kind, ratePct, calculated, saved, gap, planned, check, showGap: gap != null && Math.abs(gap) >= TARGET_GAP_SHOWN_KCAL };
}

// Why the phase in effect is off what its pace and the estimate give
function gapReason(latest, row) {
  if (latest && latest.week_start >= row.start_date) {
    if (latest.action === "keep") return `You chose Keep at the ${shortDate(latest.week_start)} check-in, so this target stayed as it was.`;
    if (latest.action === "apply") return `A check-in moves calories at most ${CHECKIN_MAX_CHANGE} kcal a week (${FIRST_CHECKIN_MAX_CHANGE} the first time), so your next check-ins keep closing it.`;
  }
  return "Your weight or the estimate has moved since this target was set; your next check-in suggests an update.";
}

function Phases({ phases, setPhases, dietPhase, dietPhases, bwLog, targetHistory, coaching = null, training = null, week = null, onSavePreset, onSaveActive, onSwitchPhase, onOpenCalendar, onOpenCalc, initialEdit = null }) {
  const [editing, setEditing] = useState(initialEdit); // { id, focus: "rate" | null }
  const today = todayISO();
  const basis = coaching?.basis || null;
  const weightLb = coaching?.weightLb ?? null;
  const ctx = { basis, weightLb, row: dietPhase, dietPhases, today, holdRatePct: coaching?.hold?.ratePct || 0 };
  const latestCheckin = coaching ? coaching.thisWeek || coaching.last : null;

  const edited = editing ? phases.find((p) => p.id === editing.id) : null;
  if (edited) {
    return (
      <TargetEditor key={edited.id} preset={edited} view={presetView(edited, ctx)} ctx={ctx} row={dietPhase}
        latestCheckin={latestCheckin} week={week} focus={editing.focus} targetHistory={targetHistory}
        setPhases={setPhases} onSavePreset={onSavePreset} onSaveActive={onSaveActive}
        onBack={() => setEditing(null)} />
    );
  }

  const prog = phaseProgress(dietPhase, today);
  const followed = dietPhase ? phases.find((p) => p.id === dietPhase.phase_id) || null : null;
  const activeView = followed ? presetView(followed, ctx) : null;
  const pace = paceReading(dietPhases, bwLog, today);
  const paceFrom = dietPhase ? paceStartsOn(dietPhases, dietPhase, rateIsMonthly(dietPhase.phase_type)) : null;
  const vctx = dietPhase ? dietPhaseContext(dietPhases, today, bwLog) : null;
  const impact = Math.round(volumeImpactPct(vctx));
  // this week's check-in would move the estimate: shown as proposed, not applied
  const proposed = coaching?.due && coaching.grounded && coaching.raw?.raw != null && basis && Math.abs(coaching.estimate - basis.kcal) >= 1 ? Math.round(coaching.estimate) : null;
  const stale = basis ? phases.filter((p) => !(dietPhase && p.id === dietPhase.phase_id) && presetView(p, ctx).showGap) : [];
  // a hidden reason a preset would stay put: no weight for its pace (realignPresets skips it)

  return (
    <div>
      <div style={S.ptKicker}>YOUR NUTRITION</div>
      <div style={S.ptTitle}>Phases</div>

      {/* the phase in effect: where you are in it, then how fast your weight is
          actually moving against the goal, in pounds (what people check first) */}
      <div style={{ ...S.ptCurrent, borderLeft: `4px solid ${dietPhase ? PHASE_COLORS[dietPhase.phase_type] : line}` }}>
        <div style={S.pcTop}>
          <div style={S.pcKicker}>CURRENT PHASE</div>
          {dietPhase && <span style={{ ...S.ptBadge, color: accent, background: "rgba(70,230,160,0.12)" }}>ACTIVE</span>}
        </div>
        {dietPhase ? (() => {
          const color = PHASE_COLORS[dietPhase.phase_type];
          const monthly = rateIsMonthly(dietPhase.phase_type);
          const per = monthly ? "month" : "week";
          const toUnits = (wk) => wk * (monthly ? WEEKS_PER_MONTH : 1);
          const goalPct = toUnits(phaseRatePct(dietPhase));
          const weight = pace.ready ? pace.avg : weightLb;
          const lb = (pct) => (weight ? Math.abs((pct / 100) * weight) : null);
          const actualPct = pace.ready ? toUnits(pace.pctPerWeek) : null;
          const plan = planStatus(dietPhase, followed, bwLog, today);
          const verdict = behindVerdict(paceVerdict(dietPhase.phase_type, actualPct, goalPct), plan);
          const maint = dietPhase.phase_type === "maintenance";
          const dir = (pct) => (pct < 0 ? "Losing" : pct > 0 ? "Gaining" : "Holding");
          // maintenance holds the weight it started at (after a cut or bulk, once the water settled)
          const anchorDate = dietPhase.phase_type === "maintenance" ? coaching?.hold?.anchorDate || maintenanceAnchorDate(dietPhases, dietPhase) : planAnchorDate(dietPhase, followed);
          const wts = phaseWeights(dietPhase, bwLog, today, anchorDate);
          const hold = coaching?.hold;
          const weeksLeft = prog.plannedWeeks && !prog.overrun ? Math.max(0, Math.ceil(daysBetween(today, dietPhase.planned_end_date) / 7)) : null;
          return (
            <>
              <div style={{ ...S.ptWeek, color }}>
                {dietPhase.phase_name.toUpperCase()} · WEEK {prog.week}{prog.plannedWeeks ? ` / ${prog.plannedWeeks}` : ""}
              </div>
              {prog.plannedWeeks ? (
                <div style={S.pcTrack}><div style={{ ...S.pcFill, width: Math.min(100, (prog.week / prog.plannedWeeks) * 100) + "%", background: color }} /></div>
              ) : null}
              <div style={S.pcWeek}>
                {shortDate(dietPhase.start_date)} – {dietPhase.planned_end_date ? shortDate(dietPhase.planned_end_date) : "open-ended"}
                {prog.overrun ? " · past planned end" : weeksLeft != null ? ` · ${weeksLeft} week${weeksLeft === 1 ? "" : "s"} left` : ""}
              </div>

              <div style={S.ptPaceBox}>
                {actualPct != null ? (
                  <>
                    <div style={S.pcKicker}>YOUR WEIGHT, LAST {monthly ? "4" : "2"} WEEKS</div>
                    <div style={S.ptPaceBig}>
                      {Math.abs(actualPct) < 0.005 || lb(actualPct) < 0.05 ? "Holding steady" : `${dir(actualPct)} ${lb(actualPct).toFixed(1)} ${WEIGHT_UNIT} / ${per}`}
                    </div>
                    <div style={{ ...S.pcStatSub, color: verdict?.ok ? accent : "#ffb454" }}>
                      {verdict?.ok ? "●" : "▲"} {verdict?.text}
                      <span style={{ color: dim, fontWeight: 400 }}>
                        {maint ? " · goal: hold steady" : ` · goal ${lb(goalPct) != null ? `${lb(goalPct).toFixed(1)} ${WEIGHT_UNIT}` : `${Math.abs(goalPct).toFixed(2)}%`} / ${per}`}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={S.pcKicker}>GOAL</div>
                    <div style={S.ptPaceBig}>
                      {maint ? "Hold your weight" : `${goalPct < 0 ? "Lose" : "Gain"} ${lb(goalPct) != null ? `${lb(goalPct).toFixed(1)} ${WEIGHT_UNIT}` : `${Math.abs(goalPct).toFixed(2)}%`} / ${per}`}
                    </div>
                    <div style={{ ...S.pcStatSub, color: dim, fontWeight: 400 }}>
                      {paceFrom && today < paceFrom
                        ? `Your actual pace shows from ${shortDate(paceFrom)} (the first weeks are mostly water).`
                        : `Your actual pace shows after 2 weeks with 4+ weigh-ins each${monthly ? " (bulks: this week and 4 weeks ago)" : ""}.`}
                    </div>
                  </>
                )}
              </div>

              {wts && wts.now != null && (
                <div style={S.ptWeights}>
                  {[
                    [maint ? "Holding" : anchorDate === dietPhase.start_date ? "Start" : "Re-planned", wts.start != null ? `${wts.start.toFixed(1)}` : "—", shortDate(anchorDate)],
                    ["Now", `${wts.now.toFixed(1)}`, wts.change != null && !maint ? `${wts.change > 0 ? "+" : wts.change < 0 ? "−" : "±"}${Math.abs(wts.change).toFixed(1)} ${WEIGHT_UNIT}` : ""],
                    maint ? null : ["Goal", wts.goalEnd != null ? `${wts.goalEnd.toFixed(1)}` : "—", dietPhase.planned_end_date ? `by ${shortDate(dietPhase.planned_end_date)}` : "open-ended"],
                  ].filter(Boolean).map(([lab, n, sub]) => (
                    <div key={lab}>
                      <div style={S.pcStatL}>{lab}</div>
                      <div style={S.pcStatN}>{n} <span style={{ fontSize: 11, color: dim, fontWeight: 400 }}>{WEIGHT_UNIT}</span></div>
                      <div style={{ fontSize: 11, color: dim }}>{sub}</div>
                    </div>
                  ))}
                </div>
              )}
              {wts?.change != null && (
                <div style={{ fontSize: 12, marginTop: 6, color: dim }}>
                  {maint
                    ? hold?.ratePct
                      ? `${Math.abs(wts.change).toFixed(1)} ${WEIGHT_UNIT} ${wts.change < 0 ? "under" : "over"}: calories are ${Math.abs(Math.round(paceKcal(hold.ratePct, weightLb)))} kcal/day ${hold.ratePct > 0 ? "above" : "below"} maintenance to get you back, less each week as you close in.`
                      : Math.abs((wts.change / wts.start) * 100) <= HOLD_TRIGGER_PCT
                        ? "Holding steady · within your normal day-to-day range."
                        : `${wts.change < 0 ? "Down" : "Up"} ${Math.abs(wts.change).toFixed(1)} ${WEIGHT_UNIT} from ${shortDate(anchorDate)}. Your next check-in brings you back.`
                    : wts.planNow != null
                      ? `On plan you'd be at ${wts.planNow.toFixed(1)} today: ${Math.abs(wts.now - wts.planNow) < 0.05 ? "right on it" : `${Math.abs(wts.now - wts.planNow).toFixed(1)} ${WEIGHT_UNIT} ${(wts.now - wts.planNow) * goalPct < 0 ? "behind" : "ahead"}`}.`
                      : ""}
                </div>
              )}


              <div style={S.ptMiniStats}>
                <div><span style={{ fontWeight: 700 }}>{followed ? fmtK(followed.target.cal) : "—"}</span> <span style={{ color: dim }}>kcal / day</span></div>
                {!maint && <div style={{ color: dim }}>goal {signPct(goalPct)} / {monthly ? "mo" : "wk"} of bodyweight</div>}
              </div>
              {activeView?.showGap && (
                <div style={S.ptNote}>
                  Eating {fmtK(activeView.saved)} kcal; your maintenance and this goal point to {fmtK(activeView.calculated)}. {gapReason(latestCheckin, dietPhase)}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                {followed && <button style={{ ...S.ghostBtn, flex: 1, minWidth: 120 }} onClick={() => setEditing({ id: followed.id, focus: null })}>Edit goal & macros</button>}
                <select value="" onChange={(e) => { const preset = phases.find((p) => p.id === e.target.value); if (preset) onSwitchPhase(preset); }}
                  style={{ ...S.fInput, flex: 1, minWidth: 140 }} aria-label="Switch phase">
                  <option value="" disabled>switch phase…</option>
                  {phases.filter((p) => p.id !== dietPhase.phase_id && isPhaseType(p.phase_type)).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}, from today</option>
                  ))}
                </select>
              </div>
            </>
          );
        })() : (
          <div style={{ fontSize: 13, color: dim, marginTop: 4 }}>No phase set yet. Plan one on the calendar, or switch to one below.</div>
        )}
      </div>

      {/* the maintenance estimate every target is calculated from */}
      <div style={S.ptPanel}>
        <div style={S.pcKicker}>MAINTENANCE ESTIMATE</div>
        {basis ? (
          <>
            <div><span style={S.ptMid}>{fmtK(basis.kcal)}</span> <span style={{ color: dim, fontSize: 13 }}>kcal / day</span></div>
            <div style={S.ptHint}>
              {basis.source === "starting" ? "Starting estimate" : basis.source === "adjusted" ? "Your number" : "Learned"}: {ESTIMATE_SOURCE[basis.source]}{basis.asOf ? ` (check-in ${shortDate(basis.asOf)})` : ""}.
              {basis.source === "starting" && ` Your data takes over at a check-in once the last ${EST_WINDOW_DAYS} days have ${EST_MIN_INCLUDED} fully logged days and ${EST_MIN_WEIGHINS} weigh-ins.`}
              {weightLb ? ` Paces use your weight, ${r1(weightLb)} ${WEIGHT_UNIT}.` : " No weigh-ins yet, so cut and bulk calories keep their saved values until you weigh in."}
            </div>
            {proposed != null && (
              <div style={{ ...S.ptNote, color: "#ffb454" }}>
                This week's check-in would move it to {fmtK(proposed)} kcal. Not applied until you finish the check-in on Plan.
              </div>
            )}
            {stale.length > 0 && weightLb && (
              <div style={S.ptNote}>
                {stale.length === 1 ? `${stale[0].name} doesn't` : `${stale.length} saved targets don't`} match this estimate yet.{" "}
                <button style={S.linkBtn} onClick={() => setPhases((prev) => realignPresets(prev, { estimate: basis.kcal, weightLb, skipIds: [dietPhase?.phase_id, basis.source === "starting" ? maintenancePreset(prev)?.id : null].filter(Boolean), date: today, reason: "estimate", source: basis.source }))}>
                  Update {stale.length === 1 ? "it" : "them"}
                </button>
              </div>
            )}
          </>
        ) : (
          <div style={S.ptHint}>
            None yet: your targets are example numbers. Use <b>Calculate my targets</b> below for a starting estimate, or set your Maintenance target's calories.
            After ~3 weeks of logging and weigh-ins, the weekly check-in learns your real maintenance.
          </div>
        )}
      </div>

      {/* RepReport */}
      {dietPhase && (
        <div style={S.ptPanel}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div>
              <div style={{ ...S.pcKicker, color: REPREPORT_AMBER, fontWeight: 700 }}>REPREPORT</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Training set ceilings</div>
            </div>
            <span style={{ ...S.ptBadge, color: impact < 0 ? PHASE_COLORS.deficit : impact > 0 ? PHASE_COLORS.surplus : PHASE_COLORS.maintenance, background: "rgba(122,167,255,0.12)" }}>
              {impact === 0 ? "Baseline" : `${impact > 0 ? "+" : "−"}${Math.abs(impact)}%`}
            </span>
          </div>
          {!training?.active && <div style={S.ptHint}>No active RepReport block — this applies when you start one.</div>}
        </div>
      )}

      {/* the saved targets */}
      <div style={S.ptSection}>Saved targets</div>
      <div style={S.ptHint}>Cuts, bulks and maintenance follow your maintenance estimate at their own rate. A one-day target is set directly.</div>
      <div style={S.ptGrid}>
        {phases.map((p) => {
          const v = presetView(p, ctx);
          const color = v.kind === "day" || !v.kind ? dim : PHASE_COLORS[v.kind];
          return (
            <div key={p.id} style={{ ...S.ptCard, ...(v.active ? { borderColor: color } : {}) }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: color, flex: "none" }} />
                <span style={S.ptCardName}>{p.name}</span>
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                {v.active && <span style={{ ...S.ptBadge, color: accent, background: "rgba(70,230,160,0.12)" }}>ACTIVE</span>}
                {!v.active && v.kind && v.kind !== "day" && <span style={{ ...S.ptBadge, color: dim, background: panel2 }}>PRESET</span>}
                {v.planned[0] && <span style={{ ...S.ptBadge, color: PHASE_COLORS.maintenance, background: "rgba(122,167,255,0.12)" }}>PLANNED {shortDate(v.planned[0].start_date).toUpperCase()}</span>}
              </div>
              {v.kind === "day" ? (
                <div style={{ ...S.ptGoal, color: dim }}>ONE-DAY TARGET</div>
              ) : v.kind ? (
                <button style={{ ...S.ptGoalBtn, color }} onClick={() => setEditing({ id: p.id, focus: "rate" })} aria-label={`Edit ${p.name} rate`}>
                  {v.kind === "maintenance" ? "GOAL Hold" : `GOAL ${rateLabel(v.kind, v.ratePct)}`}{v.kind !== "maintenance" ? " ✎" : ""}
                </button>
              ) : null}
              <div><span style={S.ptKcal}>{fmtK(p.target.cal)}</span> <span style={{ color: dim, fontSize: 11 }}>kcal / day</span></div>
              <div style={S.ptMacros}>{r0(p.target.p)}P · {r0(p.target.f)}F · {r0(p.target.c)}C</div>
              {v.showGap && !v.active && (
                <div style={S.ptCardNote}>At your estimate: {fmtK(v.calculated)} (not applied)</div>
              )}
              {!v.check.ok && <div style={{ ...S.ptCardNote, color: "#ff8a5c" }}>Needs a fix: {v.check.errors[0].split(". ")[0]}.</div>}
              {p.fit?.date && p.fit.from && (
                <div style={S.ptCardNote}>Updated {shortDate(p.fit.date)}: was {fmtK(p.fit.from.cal)}</div>
              )}
              <button style={S.ptLink} onClick={() => setEditing({ id: p.id, focus: null })}>View &amp; edit ›</button>
            </div>
          );
        })}
      </div>
      <button style={{ ...S.addSlot, marginTop: 10 }}
        onClick={() => setPhases((prev) => [...prev, { ...ph("New target", 180, 50, 250, 2500), phase_type: "maintenance" }])}>
        + add target
      </button>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button style={{ ...S.ghostBtn, flex: 1 }} onClick={onOpenCalendar}>Plan on calendar</button>
        <button style={{ ...S.ghostBtn, flex: 1, color: accent, borderColor: accent }} onClick={onOpenCalc}>Calculate my targets</button>
      </div>
      <div style={{ marginTop: 16 }}>
        <PhaseHistory dietPhases={dietPhases} bwLog={bwLog} presets={phases} targetHistory={targetHistory} />
      </div>
    </div>
  );
}

// Behind plan: the three ways back, each one tap (onReplan does the writes).
function BehindPlan({ row, preset, plan, today, dietPhases, onReplan }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const own = followingMaintenance(dietPhases, row);
  const next = [...(dietPhases || [])].filter((r) => r.start_date > row.start_date && r.id !== row.id && r !== own)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0] || null;
  const o = behindOptions({ row, wts: plan.wts, today, nextStart: next?.start_date || null, name: preset.name });
  const monthly = rateIsMonthly(row.phase_type);
  const lbPace = (pctWeek) => `${Math.abs((pctWeek / 100) * plan.wts.now * (monthly ? WEEKS_PER_MONTH : 1)).toFixed(1)} lb/${monthly ? "mo" : "wk"}`;
  const pace = lbPace(phaseRatePct(row));
  const go = async (kind, arg) => { setBusy(true); await onReplan(kind, arg); setBusy(false); setOpen(false); };
  const opt = (key, title, detail, onClick, extra = null) => (
    <button key={key} style={S.ciReason} disabled={busy} onClick={onClick}>
      <b>{title}</b><div style={{ color: dim, fontSize: 12, marginTop: 2 }}>{detail}</div>{extra}
    </button>
  );
  return (
    <div style={{ marginTop: 8 }}>
      {!open ? (
        <button style={{ ...S.linkBtn, color: "#ffb454", fontSize: 13 }} onClick={() => setOpen(true)}>Get back on plan ›</button>
      ) : (
        <div style={{ marginTop: 4 }}>
          {o.restart && opt("restart", "Plan from today", `Keep ${pace} from ${plan.wts.now.toFixed(1)} lb.`, () => go("restart"))}
          {o.later && !o.later.blockedBy && opt("later", "Finish Plan Later", `Reach your goal (${o.later.goal.toFixed(1)} lb) by ${shortDate(o.later.end)} at the same ${pace}.`, () => go("later", o.later.end))}
          {o.later?.blockedBy && <div style={{ ...S.ptHint, marginBottom: 6 }}>Finishing later would run into the phase planned for {shortDate(o.later.blockedBy)}; move that on the calendar first.</div>}
          {o.lighter && opt("lighter", "Same Date, Adjusted Goal", `Reach ${o.lighter.goal.toFixed(1)} lb by ${shortDate(o.lighter.end)} at the same ${pace}.`, () => go("lighter"))}
          {o.faster && opt("faster", "Same Date, Same Goal, Faster", `Reach your goal (${o.faster.goal.toFixed(1)} lb) by ${shortDate(o.faster.end)} by increasing your rate of ${row.phase_type === "deficit" ? "loss" : "gain"} to ${lbPace(o.faster.ratePct)}.`, () => go("faster", o.faster.ratePct),
            o.faster.warning ? <div style={{ color: "#ffb454", fontSize: 12, marginTop: 4 }}>▲ {o.faster.warning.replace(" You can still save it.", "")} Finishing the plan later keeps your pace.</div> : null)}
          {o.lighter && !o.faster && <div style={S.ptHint}>Keeping both the date and the goal would mean losing faster than a {row.phase_type === "deficit" ? (isMiniCut(row.phase_type, preset.name) ? "mini-cut" : "cut") : "bulk"} can be set to.</div>}
          <button style={{ ...S.linkBtn, color: dim, fontSize: 12, marginTop: 4 }} onClick={() => setOpen(false)}>not now</button>
        </div>
      )}
    </div>
  );
}

// One target: its rate (cuts and bulks), the calories it gives (calculated,
// read-only; a one-day target's are set directly), and its macros.
function TargetEditor({ preset, view, ctx, row, latestCheckin, week, focus, targetHistory, setPhases, onSavePreset, onSaveActive, onBack }) {
  const { basis, weightLb } = ctx;
  const kind = view.kind;
  const active = view.active;
  const hasRate = kind === "deficit" || kind === "surplus";
  const monthly = rateIsMonthly(kind);
  const rateSign = kind === "deficit" ? -1 : 1;
  const shownRate = (w) => Math.abs(roundRate(w * (monthly ? WEEKS_PER_MONTH : 1))).toFixed(2);
  const startRate = hasRate ? view.ratePct : 0;
  // maintenance's calories ARE the starting estimate until your data takes over: editable then
  const startingMaint = kind === "maintenance" && (!basis || basis.source === "starting");
  const [rateText, setRateText] = useState(hasRate ? shownRate(startRate) : "");
  const [calText, setCalText] = useState(String(Math.round(view.saved)));
  const [useCalculated, setUseCalculated] = useState(false);
  const [alsoDefault, setAlsoDefault] = useState(false);
  const [draft, setDraft] = useState({ p: r0(preset.target.p), f: r0(preset.target.f), c: r0(preset.target.c), at: view.saved });
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [showMore, setShowMore] = useState(false);     // name, use, history, remove

  // the rate typed (size only; the phase type gives the sign), per week
  const rateNum = parseFloat(rateText);
  const rateWeekly = !hasRate ? 0 : rateText === "" || isNaN(rateNum) ? null : roundRate((Math.abs(rateNum) * rateSign) / (monthly ? WEEKS_PER_MONTH : 1));
  const rateCheck = hasRate && rateWeekly != null ? checkPhaseRate(kind, preset.name, rateWeekly) : { level: "ok", message: "" };
  const rateChanged = hasRate && rateWeekly != null && Math.abs(rateWeekly - startRate) > EPS;

  // the calorie target
  let cal = view.saved, calWhy = null;
  if (kind === "day" || startingMaint) {
    cal = Math.max(0, Math.round(parseFloat(calText) || 0));
  } else if (active) {
    const calcNow = hasRate && rateWeekly != null ? phaseCalTarget(basis?.kcal ?? null, rateWeekly, weightLb) : view.calculated;
    if (useCalculated && calcNow != null) { cal = calcNow; calWhy = "calculated"; }
    else if (rateChanged && weightLb) { cal = shiftForRate({ cal: view.saved }, startRate, rateWeekly, weightLb); calWhy = "shift"; }
  } else if (hasRate || kind === "maintenance") {
    const calc = phaseCalTarget(basis?.kcal ?? null, rateWeekly ?? startRate, weightLb);
    if (calc != null) { cal = calc; calWhy = "calculated"; }
  }
  const m = cal === draft.at ? draft : { ...fitMacros(draft, cal), at: cal };
  const setMacro = (k, v) => setDraft({ ...balanceMacros(m, k, v, cal), at: cal });
  const check = checkMacros(m, cal, { phaseType: kind === "day" ? null : kind, weightLb });
  const calcAtNewRate = active && hasRate && rateWeekly != null ? phaseCalTarget(basis?.kcal ?? null, rateWeekly, weightLb) : view.calculated;

  // what saving changes, against what's saved
  const changes = [];
  if (rateChanged) changes.push(`Rate ${rateLabel(kind, startRate)} → ${rateLabel(kind, rateWeekly)}`);
  if (cal !== view.saved) changes.push(`Calories ${fmtK(view.saved)} → ${fmtK(cal)}`);
  [["Protein", "p"], ["Fat", "f"], ["Carbs", "c"]].forEach(([lab, k]) => { if (m[k] !== r0(preset.target[k])) changes.push(`${lab} ${r0(preset.target[k])} → ${m[k]} g`); });
  const dirty = changes.length > 0 || (hasRate && !active && rateChanged);
  const canSave = dirty && check.ok && rateCheck.level !== "block" && (!hasRate || rateWeekly != null) && !busy;

  const save = async () => {
    if (!canSave) return;
    const target = { p: m.p, f: m.f, c: m.c, cal };
    setBusy(true);
    if (active) {
      const ok = await onSaveActive({ target, ratePct: hasRate ? rateWeekly : null, alsoDefault });
      setBusy(false);
      if (ok) onBack();
    } else {
      onSavePreset(preset.id, { target, ratePct: hasRate ? rateWeekly : null });
      setBusy(false);
      onBack();
    }
  };
  const set = (key, val) => setPhases((prev) => prev.map((p) => (p.id === preset.id ? { ...p, [key]: val } : p)));
  const color = kind === "day" || !kind ? dim : PHASE_COLORS[kind];
  const lbPer = hasRate && rateWeekly != null && weightLb ? Math.abs((rateWeekly / 100) * weightLb * (monthly ? WEEKS_PER_MONTH : 1)) : null;
  const dayUses = kind === "day" && week ? DAYS.filter((d) => week[d]?.targetId === preset.id) : [];

  // −/+ steps the rate: 0.05%/week on a cut (≈0.09 lb at 180 lb), 0.25%/month on a bulk
  const step = monthly ? 0.25 : 0.05;
  const stepRate = (dir) => {
    const cur = isNaN(rateNum) ? Number(shownRate(startRate)) : Math.abs(rateNum);
    setRateText(Math.max(0, Math.round((cur + dir * step) / step) * step).toFixed(2));
  };
  const per = monthly ? "month" : "week";
  const was = (k) => r0(preset.target[k]);
  const helper = { p: "Adjusts carbs", f: `Min ${check.fatMin} g (20%)`, c: "Adjusts fat" };
  const gapToCalc = active && kind !== "day" && !startingMaint && !useCalculated && calcAtNewRate != null && Math.abs(cal - calcAtNewRate) >= TARGET_GAP_SHOWN_KCAL;

  return (
    <div>
      <button style={{ ...S.linkBtn, marginBottom: 10 }} onClick={onBack}>‹ All targets</button>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={S.ptTitle}>{preset.name}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ ...S.ptBadge, color: active ? accent : color, background: active ? "rgba(70,230,160,0.12)" : panel2 }}>
            {active ? "ACTIVE" : kind === "day" ? "ONE DAY" : "PRESET"}
          </span>
          <button style={S.ptMore} onClick={() => setShowMore(!showMore)} aria-label="More options">⋯</button>
        </div>
      </div>
      <div style={{ ...S.ptEditor, borderTop: `4px solid ${color}` }}>

        {/* 1 · the goal, in pounds; the % is what's stored */}
        {hasRate && (
          <div style={S.ptBlock}>
            <div style={S.pcKicker}>GOAL</div>
            <div style={S.ptPaceBig}>
              {kind === "deficit" ? "Lose" : "Gain"} {lbPer != null ? `${lbPer.toFixed(1)} ${WEIGHT_UNIT}` : rateWeekly != null ? `${Math.abs(rateNum).toFixed(2)}%` : "—"} / {per}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <button style={S.ptStep} onClick={() => stepRate(-1)} aria-label={`Slower: −${step}%`}>−</button>
              <NumInput value={rateText} onChange={(e) => setRateText(e.target.value)} autoFocus={focus === "rate"}
                aria-label="Target rate" style={{ ...S.fInput, width: 84, fontSize: 18, fontWeight: 700, textAlign: "center" }} />
              <button style={S.ptStep} onClick={() => stepRate(1)} aria-label={`Faster: +${step}%`}>+</button>
              <span style={{ color: dim, fontSize: 13 }}>% of bodyweight / {per}</span>
            </div>
            {rateWeekly == null && <div style={S.ptErr}>Enter the rate as a number.</div>}
            {rateCheck.level === "block" && <div style={S.ptErr}>✕ Won't save: {rateCheck.message}.</div>}
            {rateCheck.level === "warn" && <div style={S.ptWarn}>▲ {rateCheck.message}</div>}
            {!active && view.planned.length > 0 && (
              <div style={S.ptHint}>Already planned: {view.planned.map((r) => `${shortDate(r.start_date)} at ${rateLabel(kind, phaseRatePct(r))}`).join(", ")}. Those keep their own rate.</div>
            )}
            {active && rateChanged && (
              <label style={{ ...S.useRow, marginTop: 8 }}>
                <input type="checkbox" checked={alsoDefault} onChange={(e) => setAlsoDefault(e.target.checked)} />
                <span>Also use this rate for future {preset.name} phases</span>
              </label>
            )}
          </div>
        )}

        {/* 2 · the calories it gives */}
        <div style={S.ptBlock}>
          <div style={S.pcKicker}>{kind === "day" ? "CALORIES FOR THE DAY" : startingMaint ? "YOUR MAINTENANCE (STARTING ESTIMATE)" : "CALORIES"}</div>
          {kind === "day" || startingMaint ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
              <NumInput value={calText} onChange={(e) => setCalText(e.target.value)} aria-label="Calories"
                style={{ ...S.fInput, width: 120, fontSize: 20, fontWeight: 700 }} />
              <span style={{ color: dim, fontSize: 13 }}>kcal / day</span>
            </div>
          ) : (
            <div style={{ marginTop: 2 }}>
              {cal !== view.saved && <span style={{ color: dim, fontSize: 18, fontWeight: 600 }}>{fmtK(view.saved)} → </span>}
              <span style={S.ptBig}>{fmtK(cal)}</span> <span style={{ color: dim, fontSize: 13 }}>kcal / day</span>
            </div>
          )}
          {kind === "day" && (
            <div style={S.ptHint}>
              {basis ? `${cal - Math.round(basis.kcal) >= 0 ? "+" : "−"}${fmtK(Math.abs(cal - basis.kcal))} kcal vs your ${fmtK(basis.kcal)} maintenance (${signPct(((cal - basis.kcal) / basis.kcal) * 100, 0)}). ` : ""}
              {dayUses.length ? `Used this week on ${dayUses.map((d) => DAY_NAMES[d]).join(", ")}.` : "Pick it for a day in that week's plan."}
            </div>
          )}
          {startingMaint && <div style={S.ptHint}>Every target is worked out from this until your logged data takes over.</div>}
          {gapToCalc && (
            <div style={S.ptHint}>
              Your maintenance points to {fmtK(calcAtNewRate)}. <button style={S.linkBtn} onClick={() => setUseCalculated(true)}>Use {fmtK(calcAtNewRate)}</button>
            </div>
          )}
          {useCalculated && <div style={S.ptHint}>Using the full {fmtK(cal)} now. <button style={S.linkBtn} onClick={() => setUseCalculated(false)}>undo</button></div>}
          {/* the one thing worth knowing about where the number comes from:
              maintenance, and how far this goal sits from it */}
          {kind !== "day" && !startingMaint && (
            <div style={S.ptHint}>
              {!basis ? "No maintenance estimate yet, so calories stay as saved."
                : !hasRate ? `Your maintenance: ${fmtK(basis.kcal)} kcal.`
                : !weightLb ? `Maintenance ${fmtK(basis.kcal)} kcal. Weigh in to turn this goal into calories.`
                : (() => { const k = paceKcal(rateWeekly ?? startRate, weightLb); return `Maintenance ${fmtK(basis.kcal)} kcal · this goal is ${fmtK(Math.abs(k))} kcal/day ${k < 0 ? "under" : "over"} it.`; })()}
            </div>
          )}
        </div>

        {/* 3 · macros, balanced inside the calories */}
        <div style={{ ...S.ptBlock, borderBottom: "none", paddingBottom: 0 }}>
          <div style={S.ptMacroGrid}>
            {[["Protein", "p"], ["Fat", "f"], ["Carbs", "c"]].map(([lab, k]) => (
              <div key={k}>
                <div style={{ fontSize: 13, fontWeight: 600, color: dim, marginBottom: 4 }}>{lab}</div>
                <NumInput inputMode="numeric" value={m[k]} onChange={(e) => setMacro(k, e.target.value)} aria-label={lab}
                  style={{ ...S.fInput, fontSize: 18, fontWeight: 700 }} />
                <div style={{ fontSize: 11, color: k === "f" ? accent : dim, marginTop: 4 }}>
                  {m[k] !== was(k) ? <>was {was(k)} g{k === "f" ? ` · min ${check.fatMin}` : ""}</> : helper[k]}
                </div>
              </div>
            ))}
          </div>
          {check.errors.map((e) => <div key={e} style={S.ptErr}>✕ {e}</div>)}
          {check.notes.map((n) => <div key={n} style={S.ptWarn}>▲ {n}</div>)}
        </div>

        <button style={{ ...S.primaryBtn, width: "100%", padding: "13px 14px", fontSize: 15, marginTop: 16, opacity: canSave ? 1 : 0.5 }} disabled={!canSave} onClick={save}>
          {busy ? "Saving…" : active ? "Save · applies today" : "Save"}
        </button>
      </div>

      {showMore && (
        <div style={{ ...S.ptPanel, marginTop: 10 }}>
          <label style={S.useRow}>
            <span style={{ width: 52 }}>Name</span>
            <input value={preset.name} onChange={(e) => set("name", e.target.value)} style={{ ...S.fInput, flex: 1 }} />
          </label>
          <label style={S.useRow}>
            <span style={{ width: 52 }}>Used as</span>
            <select value={preset.phase_type || ""} onChange={(e) => set("phase_type", e.target.value)} style={{ ...S.fInput, flex: 1 }} disabled={active}>
              {!preset.phase_type && <option value="" disabled>choose…</option>}
              {PRESET_USES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </label>
          <TargetChanges rows={(targetHistory || []).filter((h) => h.preset_id === preset.id)} />
          {!active && (confirmRemove ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
              <span style={{ flex: 1, color: dim }}>Remove {preset.name}?{view.planned.length ? " Its planned phases stay on the calendar." : ""}</span>
              <button style={S.dangerBtn} onClick={() => { setPhases((prev) => prev.filter((x) => x.id !== preset.id)); onBack(); }}>Remove</button>
              <button style={S.ghostBtn} onClick={() => setConfirmRemove(false)}>Cancel</button>
            </div>
          ) : (
            <button style={S.xBtnSm} onClick={() => setConfirmRemove(true)}>✕ remove target</button>
          ))}
        </div>
      )}
      {preset.example && (
        <div style={S.exampleNote}>
          Example numbers. Change them to yours.{" "}
          <button style={S.linkBtn} onClick={() => set("example", false)}>these are mine</button>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   DATA (export / import / reset)
   ============================================================ */
function Data({ foods, phases, week, setFoods, setPhases, setWeek, debugLog, session, onDeleteStart, onDeleteFailed, onAccountDeleted }) {
  const [acctMsg, setAcctMsg] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackState, setFeedbackState] = useState("idle"); // idle | sending | sent | error

  const sendFeedback = async () => {
    setFeedbackState("sending");
    try {
      await sbSendFeedback(session, feedbackText.trim());
      setFeedbackState("sent");
      setFeedbackText("");
    } catch (e) {
      setFeedbackState("error");
      setAcctMsg(e.message);
    }
  };

  // everything in both apps, from the server
  const exportAll = async () => {
    try {
      setAcctMsg("preparing your data…");
      const data = await sbAccountAction(session, "export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `repreport-mealprep-account-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setAcctMsg("download started · check your Files / Downloads");
    } catch (e) {
      setAcctMsg("couldn't export — " + e.message);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    setAcctMsg("");
    onDeleteStart();
    try {
      await sbAccountAction(session, "delete", { confirm: "DELETE" });
      onAccountDeleted();
    } catch (e) {
      onDeleteFailed();
      setDeleting(false);
      setAcctMsg("couldn't delete — " + e.message);
    }
  };

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
        // a backup's plans; an old backup's single template becomes this week's plan
        if (isPlanStore(d.week)) setWeek(loadPlanStore(d.week, todayISO()));
        else if (d.week && typeof d.week === "object" && DAYS.some((k) => d.week[k])) setWeek((st) => withPlan(st, mondayOf(todayISO()), cleanWeek(d.week), todayISO()));
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

      <p style={{...S.note, marginTop: 8, marginBottom: 8}}>
        Legal (covers Meal Prep and RepReport) · general nutrition suggestions, not medical advice.
      </p>
      <div style={S.dataRow}>
        <a href={PRIVACY_URL} target="_blank" rel="noreferrer" style={{...S.ghostBtn, textDecoration: "none"}}>privacy policy</a>
        <a href={TERMS_URL} target="_blank" rel="noreferrer" style={{...S.ghostBtn, textDecoration: "none"}}>terms of use</a>
      </div>

      <p style={{...S.note, marginTop: 8, marginBottom: 8}}>
        Feedback · bugs, confusing screens, ideas. Goes straight to the developer.
      </p>
      <div style={S.dataRow}>
        <button style={S.ghostBtn} onClick={() => { setFeedbackOpen((o) => !o); setFeedbackState("idle"); }}>send feedback</button>
      </div>
      {feedbackOpen && (
        <div style={{ ...S.phaseCard, marginBottom: 12 }}>
          {feedbackState === "sent" ? (
            <p style={{ ...S.note, marginBottom: 0 }}>Thanks, it's sent. Every message gets read.</p>
          ) : (
            <>
              <label htmlFor="mp-feedback" style={S.fLabel}>what happened, what confused you, or what you'd change</label>
              <textarea id="mp-feedback" value={feedbackText} rows={5} disabled={feedbackState === "sending"}
                onChange={(e) => setFeedbackText(e.target.value.slice(0, 4000))}
                placeholder="e.g. the barcode scanner didn't find my protein bar…"
                style={{ ...S.fInput, marginBottom: 10, resize: "none", fontFamily: "inherit" }} />
              <div style={S.dataRow}>
                <button style={S.ghostBtn} onClick={() => setFeedbackOpen(false)} disabled={feedbackState === "sending"}>cancel</button>
                <button style={S.primaryBtn} onClick={sendFeedback} disabled={!feedbackText.trim() || feedbackState === "sending"}>
                  {feedbackState === "sending" ? "sending…" : "send"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <p style={{...S.note, marginTop: 8, marginBottom: 8}}>
        Your account (covers Meal Prep and RepReport).
      </p>
      <div style={S.dataRow}>
        <button style={S.ghostBtn} onClick={exportAll}>⬇ download all my data</button>
        <button style={{ ...S.ghostBtn, color: "#ff5d7a" }} onClick={() => setDeleteOpen((o) => !o)}>delete account</button>
      </div>
      {deleteOpen && (
        <div style={{ ...S.phaseCard, marginBottom: 12 }}>
          <p style={{ ...S.note, marginBottom: 10 }}>
            This permanently deletes your login and everything in <strong style={{ color: "#e8efe9" }}>both Meal Prep and RepReport</strong>:
            food log, weigh-ins, diet phases, training history, and photos. It can't be undone. Download your data first if you want a copy.
          </p>
          <label htmlFor="mp-delete-confirm" style={S.fLabel}>type DELETE to confirm</label>
          <input id="mp-delete-confirm" value={deleteTyped} onChange={(e) => setDeleteTyped(e.target.value)}
            autoCapitalize="characters" autoComplete="off" disabled={deleting}
            style={{ ...S.fInput, marginBottom: 10, letterSpacing: 2 }} />
          <div style={S.dataRow}>
            <button style={S.ghostBtn} onClick={() => { setDeleteOpen(false); setDeleteTyped(""); }} disabled={deleting}>cancel</button>
            <button style={{ ...S.primaryBtn, background: "#ff5d7a", borderColor: "#ff5d7a" }}
              onClick={deleteAccount} disabled={deleteTyped.trim() !== "DELETE" || deleting}>
              {deleting ? "deleting…" : "delete everything"}
            </button>
          </div>
        </div>
      )}
      {acctMsg && <div style={S.verifyBanner}>{acctMsg}</div>}

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
  viHead: { display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 13, fontWeight: 600, marginTop: 16 },
  viBar: {
    position: "relative", height: 8, borderRadius: 4, marginTop: 10,
    background: `linear-gradient(90deg, ${PHASE_COLORS.deficit}, ${PHASE_COLORS.maintenance} 50%, ${PHASE_COLORS.surplus})`,
  },
  viMarker: {
    position: "absolute", top: -3, width: 14, height: 14, borderRadius: 7,
    background: "#fff", boxShadow: "0 0 0 2px rgba(0,0,0,0.6)",
  },
  viNote: { color: dim, fontSize: 12, lineHeight: 1.45, marginTop: 10 },
  stBox: { marginTop: 16, paddingTop: 12, borderTop: `1px solid ${line}` },
  stHead: { fontSize: 13, fontWeight: 600 },
  pcNeed: { color: dim, fontSize: 12, lineHeight: 1.45, marginTop: 10 },
  // weekly check-in + day status
  ciCard: { background: panel, border: `1px solid ${accent}`, borderRadius: 12, padding: 14, marginBottom: 14 },
  ciKicker: { fontSize: 11, letterSpacing: 1.5, color: accent, fontWeight: 700 },
  ciStep: { fontSize: 12, fontWeight: 700, marginTop: 14, marginBottom: 6 },
  ciDay: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "4px 0" },
  ciLine: { fontSize: 13, margin: "4px 0" },
  ciSub: { color: dim, fontSize: 12, marginTop: 2, lineHeight: 1.45 },
  ciTable: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 },
  ciCell: { background: panel2, borderRadius: 8, padding: 8, fontSize: 14 },
  ciReason: { display: "block", width: "100%", textAlign: "left", background: panel2, border: `1px solid ${line}`, borderRadius: 8, padding: "10px 12px", marginBottom: 6, color: text, fontSize: 13, lineHeight: 1.4, cursor: "pointer", fontFamily: "inherit" },
  ciNotes: { color: dim, fontSize: 12, lineHeight: 1.5, marginTop: 8 },
  dsRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, color: dim, padding: "8px 2px", marginBottom: 10 },
  dsBtn: { background: "transparent", border: `1px solid ${line}`, color: text, borderRadius: 8, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" },
  pcEstimate: { fontSize: 12, marginTop: 10 },
  exampleNote: { fontSize: 12, color: "#ffb454", marginTop: 8, lineHeight: 1.4 },
  calcHint: { fontSize: 11, color: dim, marginTop: 4, lineHeight: 1.4 },
  calcOption: { display: "block", width: "100%", textAlign: "left", background: panel2, border: `1px solid ${line}`, borderRadius: 8, padding: "9px 10px", marginBottom: 6, color: dim, fontSize: 13, lineHeight: 1.4, cursor: "pointer", fontFamily: "inherit" },
  calcRow: { display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: `1px solid ${line}`, fontSize: 13 },
  calcPrompt: { border: `1px solid ${accent}`, borderRadius: 12, padding: 14, marginBottom: 12, background: panel2 },
  linkBtn: { background: "none", border: "none", padding: 0, color: accent, textDecoration: "underline", cursor: "pointer", font: "inherit" },
  useRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: dim, margin: "8px 0" },
  tcBox: { color: dim, fontSize: 11, lineHeight: 1.5, margin: "8px 0 6px" },
  pcPace: { fontSize: 12, fontWeight: 700, marginTop: 8 },
  pcProj: { color: dim, fontSize: 12, marginTop: 6 },
  phaseChip: {
    display: "inline-block", border: "1px solid", borderRadius: 999, padding: "3px 10px",
    fontSize: 11, fontWeight: 700, letterSpacing: 0.3, marginBottom: 10,
  },
  monthGrid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 },
  monthCell: {
    aspectRatio: "1 / 1", borderRadius: 10, fontSize: 13, cursor: "pointer",
    fontFamily: "inherit", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
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
  entryText: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 },
  entryName: { fontSize: 13, display: "flex", alignItems: "center", gap: 6 },
  entryUnit: { fontSize: 11, color: dim, lineHeight: 1.3 },
  entryMacros: { fontSize: 11, color: dim, fontFamily: "'Archivo', sans-serif", whiteSpace: "nowrap", flexShrink: 0 },
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
  // Phases tab
  ptKicker: { color: dim, fontSize: 11, letterSpacing: 2, fontWeight: 700 },
  ptTitle: { fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 30, lineHeight: 1.15, margin: "2px 0 14px", overflowWrap: "anywhere" },
  ptCurrent: { background: panel, border: `1px solid ${line}`, borderRadius: 12, padding: 14, marginBottom: 10 },
  ptBigName: { fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 24, marginTop: 4, overflowWrap: "anywhere" },
  ptWeek: { fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: 0.5, marginTop: 6, overflowWrap: "anywhere" },
  ptWeights: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${line}` },
  ptPaceBox: { marginTop: 14, paddingTop: 12, borderTop: `1px solid ${line}` },
  ptPaceBig: { fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 22, margin: "2px 0 4px" },
  ptMiniStats: { display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 13, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${line}` },
  ptStep: { width: 40, height: 40, borderRadius: 10, border: `1px solid ${line}`, background: panel2, color: text, fontSize: 20, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flex: "none" },
  ptMore: { background: "transparent", border: `1px solid ${line}`, color: dim, borderRadius: 8, width: 34, height: 30, fontSize: 16, cursor: "pointer" },
  ptStats: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${line}` },
  ptBadge: { fontSize: 10, fontWeight: 800, letterSpacing: 0.8, borderRadius: 999, padding: "3px 8px", whiteSpace: "nowrap" },
  ptPanel: { background: panel2, border: `1px solid ${line}`, borderRadius: 12, padding: "12px 14px", marginBottom: 10 },
  ptMid: { fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 22 },
  ptHint: { color: dim, fontSize: 12, lineHeight: 1.45, marginTop: 6 },
  ptNote: { fontSize: 12, lineHeight: 1.45, marginTop: 10, padding: "8px 10px", borderRadius: 8, background: panel2, border: `1px solid ${line}` },
  ptSection: { fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 20, marginTop: 18 },
  ptGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, marginTop: 10 },
  ptCard: { background: panel, border: `1px solid ${line}`, borderRadius: 12, padding: 12, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 },
  ptCardName: { fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 16, overflowWrap: "anywhere" },
  ptGoal: { fontSize: 11, fontWeight: 800, letterSpacing: 0.5, marginTop: 4 },
  ptGoalBtn: { background: "none", border: "none", padding: "4px 0", textAlign: "left", fontSize: 12, fontWeight: 800, letterSpacing: 0.3, cursor: "pointer", fontFamily: "inherit" },
  ptKcal: { fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 24 },
  ptMacros: { color: dim, fontSize: 12, paddingTop: 6, borderTop: `1px solid ${line}` },
  ptCardNote: { color: dim, fontSize: 11, lineHeight: 1.35 },
  ptLink: { background: "none", border: "none", padding: "4px 0 0", color: accent, fontWeight: 700, fontSize: 13, textAlign: "left", cursor: "pointer", fontFamily: "inherit", marginTop: "auto" },
  ptEditor: { background: panel, border: `1px solid ${line}`, borderRadius: 12, padding: 14, marginTop: 6 },
  ptBlock: { paddingBottom: 14, marginBottom: 14, borderBottom: `1px solid ${line}` },
  ptBlockHead: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 },
  ptTag: { fontSize: 11, fontWeight: 800, letterSpacing: 0.8 },
  ptBig: { fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 34 },
  ptMacroGrid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 },
  ptChanges: { fontSize: 12, lineHeight: 1.5, marginTop: 12, padding: "10px 12px", borderRadius: 8, background: panel2, border: `1px solid ${line}` },
  ptErr: { color: "#ff8a5c", fontSize: 12, lineHeight: 1.45, marginTop: 8 },
  ptWarn: { color: "#ffb454", fontSize: 12, lineHeight: 1.45, marginTop: 8 },
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
      html, body { margin: 0; background: ${ink}; }
      input, select, button { outline: none; }
      input:focus, select:focus { border-color: ${accent} !important; }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-thumb { background: ${line}; border-radius: 4px; }
      input[type=number]::-webkit-inner-spin-button { opacity: .4; }
    `}</style>
  );
}

// Named exports for the tests (tests/): the real functions and components, never copies.
export {
  PhaseCard, planStatus, behindOptions, behindVerdict, checkinMaxChange, catchUpCopy, CatchUpProposal, checkinReasons, resolveCheckinReason, cantEatMinKcal, maintenanceHold, AutoCheckinNotice, phaseWeights, paceVerdict, weightTrend, fatMinG, macroKcal, fitMacros, balanceMacros, checkMacros, phaseCalTarget, presetRatePct, realignPresets,
  phaseStartUpdate, shiftForRate, estimateBasis, checkinOutcome, splitMacros, suggestTargets, paceKcal,
  checkPhaseRate, defaultRatePct, phaseRatePct, presetsAsOf, phaseOnDate, dietPhaseContext, volumeImpactPct,
  targetsFromMaintenance, buildProteinStatus, presetView, Phases, CheckInCard, SEED_PHASES, MACRO_KCAL_TOLERANCE,
};
