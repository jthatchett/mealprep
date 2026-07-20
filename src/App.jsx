import React, { useState, useEffect, useRef } from 'react';
import { Dumbbell, Plus, Minus, ChevronRight, ChevronLeft, ChevronUp, ChevronDown, Check, X, BarChart3, Calendar, Info, Flame, TrendingUp, Repeat, Home, Trash2, Edit3, Play, Menu, Settings, Archive, StickyNote, MoreVertical, Star } from 'lucide-react';
import AuthGate from './AuthGate';

// ============================================================================
// EXERCISE LIBRARY
// ============================================================================
const EXERCISES = {
  chest: [
    { id: 'bench-bb', name: 'Barbell Bench Press', equipment: 'barbell' },
    { id: 'bench-db-incline', name: 'Incline DB Press', equipment: 'dumbbell' },
    { id: 'machine-chest', name: 'Machine Chest Press', equipment: 'machine' },
    { id: 'cable-fly', name: 'Cable Fly', equipment: 'cable' },
    { id: 'pushup', name: 'Push-Up', equipment: 'bodyweight' },
    { id: 'dips-chest', name: 'Chest Dips', equipment: 'bodyweight' },
  ],
  horizontalBack: [
    { id: 'row-bb', name: 'Barbell Row', equipment: 'barbell' },
    { id: 'row-cable', name: 'Seated Cable Row', equipment: 'cable' },
    { id: 'row-db', name: 'DB Row', equipment: 'dumbbell' },
    { id: 'row-chest-db', name: 'Chest-Supported DB Row', equipment: 'dumbbell' },
    { id: 'row-tbar-cs', name: 'T-Bar Row (chest-supported)', equipment: 'machine' },
    { id: 'row-seal', name: 'Seal Row', equipment: 'barbell' },
    { id: 'face-pull', name: 'Face Pull', equipment: 'cable' },
  ],
  verticalBack: [
    { id: 'lat-pulldown', name: 'Lat Pulldown', equipment: 'cable' },
    { id: 'pullup', name: 'Pull-Up', equipment: 'bodyweight' },
    { id: 'chinup', name: 'Chin-Up', equipment: 'bodyweight' },
    { id: 'pulldown-neutral', name: 'Neutral-Grip Pulldown', equipment: 'cable' },
  ],
  lowerBack: [
    { id: 'rack-pull', name: 'Rack Pull', equipment: 'barbell' },
    { id: 'good-morning', name: 'Good Morning', equipment: 'barbell' },
    { id: 'heavy-sldl', name: 'Heavy SLDL (strength)', equipment: 'barbell' },
    { id: 'back-extension-45', name: '45° Back Extension', equipment: 'machine' },
    { id: 'reverse-hyper', name: 'Reverse Hyperextension', equipment: 'machine' },
  ],
  frontDelts: [
    { id: 'ohp', name: 'Overhead Press', equipment: 'barbell' },
    { id: 'db-press', name: 'DB Shoulder Press', equipment: 'dumbbell' },
    { id: 'front-raise-db', name: 'DB Front Raise', equipment: 'dumbbell' },
    { id: 'front-raise-cable', name: 'Cable Front Raise', equipment: 'cable' },
    { id: 'front-raise-plate', name: 'Plate Front Raise', equipment: 'barbell' },
  ],
  sideDelts: [
    { id: 'lateral-db', name: 'DB Lateral Raise', equipment: 'dumbbell' },
    { id: 'lateral-cable', name: 'Cable Lateral Raise', equipment: 'cable' },
    { id: 'lateral-machine', name: 'Machine Lateral Raise', equipment: 'machine' },
    { id: 'lateral-leanaway', name: 'Lean-Away Cable Lateral', equipment: 'cable' },
  ],
  rearDelts: [
    { id: 'rear-delt-fly', name: 'DB Rear Delt Fly', equipment: 'dumbbell' },
    { id: 'reverse-pec-deck', name: 'Reverse Pec Deck', equipment: 'machine' },
    { id: 'cable-reverse-fly', name: 'Cable Reverse Fly', equipment: 'cable' },
    { id: 'rope-face-pull', name: 'Rope Face Pull', equipment: 'cable' },
  ],
  traps: [
    { id: 'shrug-bb', name: 'Barbell Shrug', equipment: 'barbell' },
    { id: 'shrug-db', name: 'DB Shrug', equipment: 'dumbbell' },
    { id: 'shrug-cable', name: 'Cable Shrug', equipment: 'cable' },
    { id: 'shrug-smith', name: 'Smith Shrug', equipment: 'smith' },
  ],
  biceps: [
    { id: 'curl-bb', name: 'Barbell Curl', equipment: 'barbell' },
    { id: 'curl-db', name: 'DB Curl', equipment: 'dumbbell' },
    { id: 'curl-hammer', name: 'Hammer Curl', equipment: 'dumbbell' },
    { id: 'curl-preacher', name: 'Preacher Curl', equipment: 'machine' },
    { id: 'curl-cable', name: 'Cable Curl', equipment: 'cable' },
  ],
  triceps: [
    { id: 'pushdown', name: 'Tricep Pushdown', equipment: 'cable' },
    { id: 'overhead-tri', name: 'Overhead Tricep Ext.', equipment: 'cable' },
    { id: 'cgbp', name: 'Close-Grip Bench', equipment: 'barbell' },
    { id: 'skullcrusher', name: 'Skullcrusher', equipment: 'barbell' },
    { id: 'dips-tri', name: 'Tricep Dips', equipment: 'bodyweight' },
  ],
  quads: [
    { id: 'squat-bb', name: 'Back Squat', equipment: 'barbell' },
    { id: 'squat-front', name: 'Front Squat', equipment: 'barbell' },
    { id: 'leg-press', name: 'Leg Press', equipment: 'machine' },
    { id: 'hack-squat', name: 'Hack Squat', equipment: 'machine' },
    { id: 'leg-ext', name: 'Leg Extension', equipment: 'machine' },
    { id: 'lunge', name: 'Walking Lunge', equipment: 'dumbbell' },
  ],
  hamstrings: [
    { id: 'rdl', name: 'Romanian Deadlift', equipment: 'barbell' },
    { id: 'leg-curl-seated', name: 'Seated Leg Curl', equipment: 'machine' },
    { id: 'leg-curl-lying', name: 'Lying Leg Curl', equipment: 'machine' },
    { id: 'stiff-leg-dl', name: 'Stiff Leg Deadlift', equipment: 'dumbbell' },
  ],
  glutes: [
    { id: 'hip-thrust', name: 'Hip Thrust', equipment: 'barbell' },
    { id: 'glute-bridge', name: 'Glute Bridge', equipment: 'barbell' },
    { id: 'bss', name: 'Bulgarian Split Squat', equipment: 'dumbbell' },
  ],
  adductors: [
    { id: 'adduction-cable', name: 'Cable Hip Adduction', equipment: 'cable' },
    { id: 'adduction-machine', name: 'Machine Hip Adduction', equipment: 'machine' },
    { id: 'copenhagen-plank', name: 'Copenhagen Side Plank', equipment: 'bodyweight' },
  ],
  abductors: [
    { id: 'abduction-cable', name: 'Cable Hip Abduction', equipment: 'cable' },
    { id: 'abduction-machine', name: 'Machine Hip Abduction', equipment: 'machine' },
    { id: 'abduction-banded', name: 'Standing Banded Abduction', equipment: 'bodyweight' },
  ],
  calves: [
    { id: 'calf-standing', name: 'Standing Calf Raise', equipment: 'machine' },
    { id: 'calf-seated', name: 'Seated Calf Raise', equipment: 'machine' },
  ],
  abs: [
    { id: 'hanging-leg-raise', name: 'Hanging Leg Raise', equipment: 'bodyweight' },
    { id: 'cable-crunch', name: 'Cable Crunch', equipment: 'cable' },
    { id: 'ab-wheel', name: 'Ab Wheel Rollout', equipment: 'bodyweight' },
    { id: 'decline-situp', name: 'Decline Sit-Up', equipment: 'bodyweight' },
    { id: 'plank', name: 'Plank', equipment: 'bodyweight' },
    { id: 'russian-twist', name: 'Russian Twist', equipment: 'dumbbell' },
    { id: 'pallof-press', name: 'Pallof Press', equipment: 'cable' },
  ],
};

const MUSCLE_GROUPS = Object.keys(EXERCISES);

// ============================================================================
// EQUIPMENT CATEGORIES (for Home Gym Mode filtering)
// ============================================================================
// Each category maps a UI label to an internal equipment value used by the
// exercise library. CALISTHENICS is the user-facing rename of 'bodyweight'.
// SMITH has no library exercises yet — users can add customs tagged with this
// equipment value (future work: seed library entries).
const EQUIPMENT_CATEGORIES = [
  { value: 'barbell',     label: 'BARBELL' },
  { value: 'dumbbell',    label: 'DUMBBELL' },
  { value: 'cable',       label: 'CABLE' },
  { value: 'machine',     label: 'MACHINE' },
  { value: 'smith',       label: 'SMITH' },
  { value: 'bodyweight',  label: 'CALISTHENICS' },
];
const ALL_EQUIPMENT_VALUES = EQUIPMENT_CATEGORIES.map(c => c.value);

// ============================================================================
// SET TECHNIQUES — intensity techniques taggable per set in the workout logger.
// Purely metadata (doesn't feed autoregulation math); `abbr` renders as a
// compact badge in SetRow / WorkoutViewer, `label` renders in the picker modal.
// ============================================================================
const TECHNIQUES = {
  dropset:   { label: 'Drop Set',        abbr: 'DS', color: 'text-orange-400 bg-orange-400/10 border-orange-400/40' },
  myorep:    { label: 'Myo-Rep',         abbr: 'MR', color: 'text-fuchsia-400 bg-fuchsia-400/10 border-fuchsia-400/40' },
  restpause: { label: 'Rest-Pause',      abbr: 'RP', color: 'text-indigo-400 bg-indigo-400/10 border-indigo-400/40' },
  cluster:   { label: 'Cluster Set',     abbr: 'CL', color: 'text-teal-400 bg-teal-400/10 border-teal-400/40' },
  partials:  { label: 'Partial Reps',    abbr: 'PR', color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/40' },
  forced:    { label: 'Forced Reps',     abbr: 'FR', color: 'text-rose-400 bg-rose-400/10 border-rose-400/40' },
  eccentric: { label: 'Slow Eccentric',  abbr: 'EC', color: 'text-lime-400 bg-lime-400/10 border-lime-400/40' },
  occlusion: { label: 'Occlusion (BFR)', abbr: 'OC', color: 'text-purple-400 bg-purple-400/10 border-purple-400/40' },
};

// ============================================================================
// TEMPLATES
// ============================================================================
const TEMPLATES = {
  'upper-lower-4': {
    name: 'Upper / Lower (4 day)',
    daysPerWeek: 4,
    days: [
      { name: 'Upper A', muscles: ['chest', 'horizontalBack', 'verticalBack', 'sideDelts', 'rearDelts', 'biceps', 'triceps'] },
      { name: 'Lower A', muscles: ['quads', 'hamstrings', 'glutes', 'calves'] },
      { name: 'Upper B', muscles: ['horizontalBack', 'verticalBack', 'chest', 'sideDelts', 'rearDelts', 'triceps', 'biceps'] },
      { name: 'Lower B', muscles: ['hamstrings', 'quads', 'glutes', 'calves'] },
    ],
  },
  'ppl-6': {
    name: 'Push / Pull / Legs (6 day)',
    daysPerWeek: 6,
    days: [
      { name: 'Push A', muscles: ['chest', 'sideDelts', 'triceps'] },
      { name: 'Pull A', muscles: ['horizontalBack', 'verticalBack', 'rearDelts', 'biceps'] },
      { name: 'Legs A', muscles: ['quads', 'hamstrings', 'glutes', 'calves'] },
      { name: 'Push B', muscles: ['chest', 'sideDelts', 'triceps'] },
      { name: 'Pull B', muscles: ['horizontalBack', 'verticalBack', 'rearDelts', 'biceps'] },
      { name: 'Legs B', muscles: ['hamstrings', 'quads', 'glutes', 'calves'] },
    ],
  },
  'full-3': {
    name: 'Full Body (3 day)',
    daysPerWeek: 3,
    days: [
      { name: 'Full A', muscles: ['quads', 'chest', 'horizontalBack', 'sideDelts'] },
      { name: 'Full B', muscles: ['hamstrings', 'verticalBack', 'chest', 'biceps', 'triceps'] },
      { name: 'Full C', muscles: ['glutes', 'sideDelts', 'rearDelts', 'horizontalBack', 'calves'] },
    ],
  },
};

// ============================================================================
// CUSTOM SPLIT STRUCTURES (Path B — priority-based meso builder)
// ============================================================================
// Base anatomical structures by days/week. Muscles filtered by user priorities,
// starting sets adjusted by emphasize/maintain.
const CUSTOM_SPLITS = {
  3: [
    { name: 'Full A', muscles: ['chest', 'horizontalBack', 'quads', 'sideDelts', 'biceps', 'calves'] },
    { name: 'Full B', muscles: ['verticalBack', 'hamstrings', 'chest', 'rearDelts', 'triceps', 'glutes'] },
    { name: 'Full C', muscles: ['quads', 'sideDelts', 'horizontalBack', 'biceps', 'triceps', 'calves'] },
  ],
  4: [
    { name: 'Upper A', muscles: ['chest', 'horizontalBack', 'verticalBack', 'sideDelts', 'rearDelts', 'biceps', 'triceps'] },
    { name: 'Lower A', muscles: ['quads', 'hamstrings', 'glutes', 'calves'] },
    { name: 'Upper B', muscles: ['horizontalBack', 'verticalBack', 'chest', 'sideDelts', 'rearDelts', 'triceps', 'biceps'] },
    { name: 'Lower B', muscles: ['hamstrings', 'quads', 'glutes', 'calves'] },
  ],
  5: [
    { name: 'Upper A', muscles: ['chest', 'horizontalBack', 'verticalBack', 'sideDelts', 'rearDelts'] },
    { name: 'Lower A', muscles: ['quads', 'hamstrings', 'glutes', 'calves'] },
    { name: 'Arms+Delts', muscles: ['biceps', 'triceps', 'sideDelts', 'rearDelts'] },
    { name: 'Upper B', muscles: ['horizontalBack', 'verticalBack', 'chest', 'sideDelts', 'rearDelts'] },
    { name: 'Lower B', muscles: ['hamstrings', 'quads', 'glutes', 'calves'] },
  ],
  6: [
    { name: 'Push A', muscles: ['chest', 'sideDelts', 'triceps'] },
    { name: 'Pull A', muscles: ['horizontalBack', 'verticalBack', 'rearDelts', 'biceps'] },
    { name: 'Legs A', muscles: ['quads', 'hamstrings', 'glutes', 'calves'] },
    { name: 'Push B', muscles: ['chest', 'sideDelts', 'triceps'] },
    { name: 'Pull B', muscles: ['horizontalBack', 'verticalBack', 'rearDelts', 'biceps'] },
    { name: 'Legs B', muscles: ['hamstrings', 'quads', 'glutes', 'calves'] },
  ],
};

// Starting set count per muscle adjusted by priority
const getStartingSets = (muscle, priority) => {
  const base = STARTING_SETS[muscle] || 2;
  if (priority === 'emphasize') return base + 2; // higher MEV-ish floor for prioritized muscles
  if (priority === 'maintain') return Math.max(1, base - 1);
  return base; // template default (priority undefined)
};

// Filter custom split by priorities — drop ignored muscles, return clean day structure
const buildCustomDays = (daysPerWeek, priorities) => {
  const base = CUSTOM_SPLITS[daysPerWeek] || CUSTOM_SPLITS[4];
  return base.map(day => ({
    name: day.name,
    muscles: day.muscles.filter(m => priorities[m] !== 'ignore'),
  })).filter(day => day.muscles.length > 0); // drop fully-empty days
};

// ============================================================================
// AUTOREGULATION LOGIC
// ============================================================================
// Target RIR drops 1 per week, deload jumps to 5 (spec says ~8 but that's unrealistically easy)
const getTargetRIR = (weekNum, totalWeeks) => {
  if (weekNum === totalWeeks) return 5; // deload
  const start = 3;
  return Math.max(0, start - (weekNum - 1));
};

// Starting sets per muscle group (MEV-ish defaults)
const STARTING_SETS = {
  chest: 2, horizontalBack: 2, verticalBack: 2, lowerBack: 2, biceps: 2, triceps: 2,
  frontDelts: 1, sideDelts: 2, rearDelts: 2, traps: 2,
  quads: 2, hamstrings: 2, glutes: 2,
  adductors: 1, abductors: 2,
  calves: 2, abs: 2,
};

// Per-session set count from total weekly sets (split across training days for that muscle)
const splitSetsAcrossDays = (totalSets, dayCount) => {
  if (dayCount === 0) return 0;
  return Math.ceil(totalSets / dayCount);
};

// Progression algorithm: returns next week's set count for a muscle
const progressSets = (currentSets, feedback) => {
  if (!feedback) return currentSets + 1; // default add 1 if no feedback
  const { pump, soreness, workload } = feedback;
  // High soreness or too-hard workload = hold or reduce
  if (soreness >= 3 || workload === 'too-hard') return currentSets;
  if (soreness === 2 && workload === 'manageable') return currentSets + 1;
  if (pump >= 2 && soreness === 0 && workload === 'too-easy') return currentSets + 2; // clear MEV-undershoot only
  return currentSets + 1;
};

// Weight progression suggestion based on RIR delta. `assisted` flips the sign:
// on an assist machine the number on the stack is counterbalance, not
// resistance, so "too easy" means LESS assist (weight down), not more.
const suggestWeightChange = (avgActualRIR, targetRIR, assisted = false) => {
  const delta = avgActualRIR - targetRIR;
  const sign = assisted ? -1 : 1;
  if (delta >= 2) return {
    direction: sign > 0 ? 'up' : 'down', pct: sign * 0.075,
    msg: assisted ? 'Too easy — reduce assist ~5-10%' : 'Weight too light — increase ~5-10%'
  };
  if (delta <= -1.5) return {
    direction: sign > 0 ? 'down' : 'up', pct: sign * -0.05,
    msg: assisted ? 'Too hard — add assist ~5%' : 'Weight too heavy — decrease ~5%'
  };
  if (delta >= 1) return {
    direction: sign > 0 ? 'up' : 'down', pct: sign * 0.025,
    msg: assisted ? 'Slightly easy — small assist reduction' : 'Slightly light — small bump'
  };
  return { direction: 'hold', pct: 0, msg: 'On target — hold weight, add reps' };
};

// ============================================================================
// TECHNIQUE VOLUME CREDITING
// ============================================================================
// Which bucket each tagged technique falls into. Untagged rows, and any
// technique not listed here (cluster/partials/forced/eccentric/occlusion),
// are pure modifiers on an otherwise-normal set — full 1.0 credit, and a
// valid read on that week's calibration. Only techniques that spawn genuine
// extra/bonus rows at abbreviated rest get bucketed as continuations:
//   'continuation-flat'  → flat 0.5 credit per row, no decay (myo-rep mini-sets,
//                          rest-pause continuations — same weight as the set
//                          before them, so nothing to taper)
//   'continuation-decay' → 2/3-retention decay per row (drop sets — weight
//                          actually changes, and physically tends to be a
//                          single drop rather than a long chain)
// Continuation rows are excluded from RIR-averaging and from anchoring next
// week's weight: they're reached via abbreviated rest, not full recovery, so
// their RIR doesn't answer "was the working weight calibrated correctly."
const TECHNIQUE_CLASS = {
  myorep: 'continuation-flat',
  restpause: 'continuation-flat',
  dropset: 'continuation-decay',
};
const DECAY_RETENTION = 2 / 3; // dropset: 0.5, 0.333, 0.222… → asymptotes at +1.5 total, same ceiling as the flat rule's typical 3-mini-set case

// Walks one exercise's logged sets in order and annotates each row with:
//  - creditedValue: what it's worth toward next week's set count (1.0 for a
//    calibration set, 0.5 or decaying-0.5 for a continuation row)
//  - isCalibration: whether its RIR/weight is a valid calibration read
// A continuation streak (consecutive rows tagged with the SAME technique)
// decays or stays flat together; it resets the moment an untagged row or a
// different technique appears — so two unrelated drop sets on the same
// exercise each get their own fresh ramp, not a discounted continuation of
// each other's.
const analyzeSets = (sets) => {
  let streakTechnique = null;
  let streakPosition = 0;
  return sets.map(set => {
    const cls = set.technique ? TECHNIQUE_CLASS[set.technique] : undefined;
    if (!cls) {
      streakTechnique = null;
      streakPosition = 0;
      return { set, creditedValue: 1.0, isCalibration: true };
    }
    streakPosition = (set.technique === streakTechnique) ? streakPosition + 1 : 1;
    streakTechnique = set.technique;
    const creditedValue = cls === 'continuation-flat'
      ? 0.5
      : 0.5 * Math.pow(DECAY_RETENTION, streakPosition - 1);
    return { set, creditedValue, isCalibration: false };
  });
};

// ============================================================================
// STORAGE HELPERS
// ============================================================================
const STORAGE_KEY = 'meso:active';
const ARCHIVE_KEY = 'meso:archive';
const PREFS_KEY = 'app:prefs';
const CUSTOM_EX_KEY = 'customExercises';
const VIDEOS_KEY = 'exerciseVideos'; // user-configured video URLs by exercise id (library or custom)
const NOTES_KEY = 'exerciseNotes'; // user-configured notes by exercise id (equipment settings, technique cues)

// ============================================================================
// SCHEMA VERSIONING & MIGRATIONS
// ============================================================================
// Persisted data is stored as { _version, data }. When a stored shape changes,
// bump SCHEMA_VERSIONS[kind] AND add a migration function in MIGRATIONS[kind].
// Example: MIGRATIONS.meso[2] = (data) => ({ ...data, restDays: [] });
// Legacy unwrapped data is auto-treated as v1 on first load.
const SCHEMA_VERSIONS = {
  meso: 1,
  prefs: 1,
  customExercises: 1,
  exerciseVideos: 1,
  exerciseNotes: 1,
  archive: 1,
};

const MIGRATIONS = {
  meso: {},
  prefs: {},
  customExercises: {},
  exerciseVideos: {},
  exerciseNotes: {},
  archive: {},
};

const KIND_BY_KEY = {
  [STORAGE_KEY]: 'meso',
  [PREFS_KEY]: 'prefs',
  [CUSTOM_EX_KEY]: 'customExercises',
  [VIDEOS_KEY]: 'exerciseVideos',
  [NOTES_KEY]: 'exerciseNotes',
};

const isWrapped = (obj) =>
  obj && typeof obj === 'object' && '_version' in obj && 'data' in obj;

const runMigrations = (kind, wrapped) => {
  let version = wrapped._version || 1;
  let data = wrapped.data;
  const target = SCHEMA_VERSIONS[kind] || 1;
  while (version < target) {
    const fn = MIGRATIONS[kind]?.[version + 1];
    if (!fn) break;
    data = fn(data);
    version++;
  }
  return data;
};

// ============================================================================
// COMPONENTS
// ============================================================================

const FONT_STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Archivo:wght@400;500;600;800;900&display=swap');
  body, html, #root { font-family: 'Archivo', sans-serif; }
  .mono { font-family: 'JetBrains Mono', monospace; }
`;

function AppInner({ trainingData, saveTrainingData, signOut }) {
  const [view, setView] = useState('home');
  const [meso, setMeso] = useState(null);
  const [prefs, setPrefs] = useState({ units: 'lbs', homeGym: false, equipment: [] });
  const [activeWorkout, setActiveWorkout] = useState(null);
  const [customExercises, setCustomExercises] = useState({});
  const [exerciseVideos, setExerciseVideos] = useState({});
  const [exerciseNotes, setExerciseNotes] = useState({});
  const [archive, setArchive] = useState([]); // completed/replaced mesocycles, newest first
  const [loaded, setLoaded] = useState(false);

  // trainingData is the full blob: { meso, prefs, customExercises, exerciseVideos, archive }
  // each in { _version, data } shape, already fetched by AuthGate.
  useEffect(() => {
    const unwrap = (kind, wrapped) => {
      if (!wrapped) return null;
      const w = isWrapped(wrapped) ? wrapped : { _version: 1, data: wrapped };
      return runMigrations(kind, w);
    };

    const m = unwrap('meso', trainingData?.meso);
    const p = unwrap('prefs', trainingData?.prefs);
    const ce = unwrap('customExercises', trainingData?.customExercises);
    const ev = unwrap('exerciseVideos', trainingData?.exerciseVideos);
    const en = unwrap('exerciseNotes', trainingData?.exerciseNotes);
    const ar = unwrap('archive', trainingData?.archive);

    if (m) setMeso(m);
    if (p) setPrefs(p);
    if (ce) setCustomExercises(ce);
    if (ev) setExerciseVideos(ev);
    if (en) setExerciseNotes(en);
    if (ar) setArchive(ar);
    setLoaded(true);
  }, [trainingData]);

  // Single source of truth for the saveTrainingData blob shape — used by both
  // the debounced routine-edit save below and completeWorkout's immediate
  // save further down, so the two paths can't drift out of sync as fields
  // get added later. Accepts overrides since a caller with a value that
  // hasn't finished propagating into state yet (e.g. completeWorkout's
  // `updated` meso, right after calling setMeso but before the re-render)
  // needs to save that value directly rather than the stale closure read.
  const buildSaveBlob = (overrides = {}) => ({
    meso: { _version: SCHEMA_VERSIONS.meso, data: overrides.meso ?? meso },
    prefs: { _version: SCHEMA_VERSIONS.prefs, data: overrides.prefs ?? prefs },
    customExercises: { _version: SCHEMA_VERSIONS.customExercises, data: overrides.customExercises ?? customExercises },
    exerciseVideos: { _version: SCHEMA_VERSIONS.exerciseVideos, data: overrides.exerciseVideos ?? exerciseVideos },
    exerciseNotes: { _version: SCHEMA_VERSIONS.exerciseNotes, data: overrides.exerciseNotes ?? exerciseNotes },
    archive: { _version: SCHEMA_VERSIONS.archive, data: overrides.archive ?? archive },
  });

  // Single atomic save: combine all sub-states into one jsonb blob
  // and upsert to training_data. Debounced so rapid set-by-set logging
  // doesn't fire a network request on every keystroke.
  useEffect(() => {
    if (!loaded) return;
    const handle = setTimeout(() => {
      saveTrainingData(buildSaveBlob());
    }, 800);
    return () => clearTimeout(handle);
  }, [meso, prefs, customExercises, exerciseVideos, exerciseNotes, archive, loaded]);


  // Delete a custom exercise globally: clean up customExercises + exerciseVideos
  // (callers may also need to clean local refs — MesoSetup does selectedExercises cleanup)
  const deleteCustomExercise = (exerciseId, muscle) => {
    setCustomExercises({
      ...customExercises,
      [muscle]: (customExercises[muscle] || []).filter(e => e.id !== exerciseId),
    });
    const nextVideos = { ...exerciseVideos };
    delete nextVideos[exerciseId];
    setExerciseVideos(nextVideos);
  };

  // Permanently swap an exercise across all future uncompleted days in the active meso.
  // Called from WorkoutLogger when user chooses "rest of meso" swap.
  const handleSwapPermanent = (oldExId, newEx) => {
    if (!meso || !activeWorkout) return;
    const updated = JSON.parse(JSON.stringify(meso));
    const { weekIdx: curWeek, dayIdx: curDay } = activeWorkout;
    updated.weeks.forEach((week, wIdx) => {
      week.days.forEach((day, dIdx) => {
        // Skip past weeks/days and already-completed days
        if (wIdx < curWeek) return;
        if (wIdx === curWeek && dIdx < curDay) return;
        if (day.completed) return;
        if (!day.exercises) return;
        day.exercises = day.exercises.map(ex =>
          ex.id === oldExId
            ? { ...ex, id: newEx.id, name: newEx.name, equipment: newEx.equipment,
                isCustom: newEx.isCustom || false, assisted: newEx.assisted || false,
                videoUrl: newEx.videoUrl || null, weightNote: null }
            : ex
        );
      });
    });
    setMeso(updated);
  };

  // Permanently delete an exercise from the current workout and every remaining
  // instance of it in the active meso (REST OF MESO only — mirrors
  // handleSwapPermanent's traversal exactly, removing instead of replacing).
  const handleDeletePermanent = (exId) => {
    if (!meso || !activeWorkout) return;
    const updated = JSON.parse(JSON.stringify(meso));
    const { weekIdx: curWeek, dayIdx: curDay } = activeWorkout;
    updated.weeks.forEach((week, wIdx) => {
      week.days.forEach((day, dIdx) => {
        // Skip past weeks/days and already-completed days
        if (wIdx < curWeek) return;
        if (wIdx === curWeek && dIdx < curDay) return;
        if (day.completed) return;
        if (!day.exercises) return;
        day.exercises = day.exercises.filter(ex => ex.id !== exId);
        // Keep the muscle-summary label (WeekCard) in sync — drop any muscle
        // that no longer has an exercise on this day. Gated to generated
        // weeks: an ungenerated week's exercises array is empty because it
        // hasn't been built yet, not because anything was removed, so
        // deriving "remaining" muscles from it would wrongly zero the label.
        // Ungenerated weeks get the same correction later, in generateNextWeek,
        // once real exercises exist to derive from.
        if (week.generated && day.muscles) {
          const remainingMuscles = new Set(day.exercises.map(ex => ex.muscle));
          day.muscles = day.muscles.filter(m => remainingMuscles.has(m));
        }
      });
    });
    setMeso(updated);
  };

  // Permanently add a brand-new exercise to this SAME day-slot going forward
  // (REST OF MESO scope for the add panel's "meso" choice). Unlike swap/delete,
  // there's no existing instance to search for across every day — a day-slot
  // index (curDay) means the same day-type in every week (Push A is always
  // days[0], etc, fixed at meso creation), so this indexes that slot directly
  // instead of scanning every day. Includes curWeek's own curDay so a
  // REST-OF-MESO add survives an early exit, same as swap/delete; that copy
  // is superseded by WorkoutLogger's local state once the session completes.
  const handleAddPermanent = (muscle, newEx) => {
    if (!meso || !activeWorkout) return;
    const updated = JSON.parse(JSON.stringify(meso));
    const { weekIdx: curWeek, dayIdx: curDay } = activeWorkout;
    updated.weeks.forEach((week, wIdx) => {
      if (wIdx < curWeek) return;
      const day = week.days[curDay];
      if (!day) return;
      if (day.completed) return;
      if (!day.exercises) return; // ungenerated future week — nothing to append to yet
      const startSets = getStartingSets(muscle, undefined);
      const targetRIR = week.targetRIR ?? 2;
      day.exercises.push({
        id: newEx.id,
        name: newEx.name,
        muscle,
        assisted: newEx.assisted || false,
        videoUrl: newEx.videoUrl || null,
        sets: Array(startSets).fill(null).map(() => ({
          weight: 0, reps: null, rirTarget: targetRIR, rirActual: null, technique: null,
        })),
      });
      if (day.muscles && !day.muscles.includes(muscle)) {
        day.muscles = [...day.muscles, muscle];
      }
    });
    setMeso(updated);
  };

  // Permanently apply a mid-session reorder to this SAME day-slot going forward.
  // permutation[newPos] = originalPos, describing how today's exercises array was
  // shuffled. Applied structurally by position (like handleAddPermanent, this
  // indexes week.days[curDay] directly rather than searching every day) — a
  // future day keeps whatever exercises it actually has, just resequenced the
  // same way today's were. Skips any day whose exercise count has drifted from
  // today's, since position-based correspondence isn't well-defined there.
  const handleReorderPermanent = (permutation) => {
    if (!meso || !activeWorkout || !permutation) return;
    const updated = JSON.parse(JSON.stringify(meso));
    const { weekIdx: curWeek, dayIdx: curDay } = activeWorkout;
    updated.weeks.forEach((week, wIdx) => {
      if (wIdx < curWeek) return;
      const day = week.days[curDay];
      if (!day) return;
      if (day.completed) return;
      if (!day.exercises || day.exercises.length !== permutation.length) return;
      day.exercises = permutation.map(origIdx => day.exercises[origIdx]);
    });
    setMeso(updated);
  };

  // Star a muscle's growth-target exercise (meso-wide — one starred exercise
  // per muscle, replacing any prior one). generateNextWeek reads this to
  // decide which exercise absorbs that muscle's earned sets each session.
  const handleSetGrowthTarget = (muscle, exerciseId) => {
    if (!meso) return;
    setMeso({ ...meso, growthTargets: { ...(meso.growthTargets || {}), [muscle]: exerciseId } });
  };

  // Clear a muscle's star entirely — future growth for that muscle falls
  // back to RIR-headroom selection with no confirmation needed, since this
  // is the more conservative direction (no emphasis being overwritten).
  const handleClearGrowthTarget = (muscle) => {
    if (!meso) return;
    const next = { ...(meso.growthTargets || {}) };
    delete next[muscle];
    setMeso({ ...meso, growthTargets: next });
  };

  // Nuclear: wipe stored training data and reset in-memory state to defaults.
  // Archive is intentionally preserved — this resets your ACTIVE setup, not
  // your training history. (Existing Settings copy already promises this scope.)
  const handleResetAllData = async () => {
    const emptyPrefs = { units: 'lbs', homeGym: false, equipment: [] };
    try {
      await saveTrainingData({
        meso: { _version: SCHEMA_VERSIONS.meso, data: null },
        prefs: { _version: SCHEMA_VERSIONS.prefs, data: emptyPrefs },
        customExercises: { _version: SCHEMA_VERSIONS.customExercises, data: {} },
        exerciseVideos: { _version: SCHEMA_VERSIONS.exerciseVideos, data: {} },
        exerciseNotes: { _version: SCHEMA_VERSIONS.exerciseNotes, data: {} },
        archive: { _version: SCHEMA_VERSIONS.archive, data: archive },
      });
    } catch (e) { console.error('Reset failed:', e); }
    setMeso(null);
    setPrefs(emptyPrefs);
    setCustomExercises({});
    setExerciseVideos({});
    setExerciseNotes({});
    setView('home');
  };

  if (!loaded) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <style>{FONT_STYLE}</style>
        <div className="text-zinc-500 mono text-sm tracking-widest">LOADING…</div>
      </div>
    );
  }

  const startWorkout = (dayIdx, weekIdx) => {
    setActiveWorkout({ dayIdx, weekIdx });
    setView('workout');
  };

  const viewWorkout = (dayIdx, weekIdx) => {
    setActiveWorkout({ dayIdx, weekIdx });
    setView('workoutView');
  };

  // Folds this completed day's technique tags into meso.stickyTechniques so
  // next week's prescription can carry them forward. Two different sticky
  // rules, because "which technique" and "which literal set index" mean
  // different things depending on the tag:
  //  - Calibration-classified tags (untagged sets, and load-preserving tags
  //    like cluster/partials/forced/eccentric/occlusion) get exactly 1.0
  //    credit each, so this week's raw set index IS next week's credited
  //    index — literal (day-slot, exercise, set-index) stickiness is correct.
  //  - Continuation tags (myo-rep, rest-pause, drop-set) get <1.0 credit per
  //    row, so next week's CREDITED set count is smaller than this week's
  //    RAW set count. Sticking those by literal index silently drops tags
  //    off the end the moment the prescribed row count shrinks relative to
  //    the raw log — which is exactly what happens once a myo-rep block runs
  //    more than ~2 mini-sets. Instead, continuation tags are sticky per
  //    (day-slot, exercise) as a single ":continuation" entry — "this
  //    exercise's non-calibration rows are myo-rep" — and get reapplied to
  //    however many continuation-slot rows next week actually generates.
  const reconcileStickyTechniques = (mesoData, dayIdx, exercises) => {
    const sticky = { ...(mesoData.stickyTechniques || {}) };
    exercises.forEach(ex => {
      const contKey = `${dayIdx}:${ex.id}:continuation`;
      let continuationTechnique = null;
      ex.sets.forEach((set, setIdx) => {
        const key = `${dayIdx}:${ex.id}:${setIdx}`;
        if (set.technique && TECHNIQUE_CLASS[set.technique]) {
          continuationTechnique = set.technique; // last-tagged wins if mixed
        } else if (set.technique) {
          sticky[key] = set.technique;
        } else if (key in sticky) {
          delete sticky[key];
        }
      });
      if (continuationTechnique) sticky[contKey] = continuationTechnique;
      else delete sticky[contKey];
    });
    return sticky;
  };

  const completeWorkout = (workoutLog) => {
    const updated = { ...meso };
    const wk = updated.weeks[activeWorkout.weekIdx];
    wk.days[activeWorkout.dayIdx] = { ...wk.days[activeWorkout.dayIdx], ...workoutLog, completed: true };
    updated.stickyTechniques = reconcileStickyTechniques(updated, activeWorkout.dayIdx, workoutLog.exercises);
    // Check if week complete → generate next week prescription
    const allDone = wk.days.every(d => d.completed);
    if (allDone && activeWorkout.weekIdx < updated.weeks.length - 1) {
      generateNextWeek(updated, activeWorkout.weekIdx);
    }
    // Completion is rare, discrete, and high-stakes — unlike routine edits
    // (typing a note, adjusting a setting), it doesn't need the shared
    // debounce. Save it right now rather than waiting for that timer, to
    // close the window where a tab reload before the debounce fires could
    // revert "done" back to "not done" — the logged numbers stay safe either
    // way via the localStorage draft, but this protects the completion +
    // feedback data itself. The debounced effect will also fire shortly
    // after from the same setMeso call; the resulting duplicate save is
    // harmless, just a bit redundant.
    setMeso(updated);
    saveTrainingData(buildSaveBlob({ meso: updated }));
    setActiveWorkout(null);
    setView('home');
  };

  const generateNextWeek = (mesoData, completedWeekIdx) => {
    const nextIdx = completedWeekIdx + 1;
    const isDeload = nextIdx === mesoData.weeks.length - 1;
    const completedWeek = mesoData.weeks[completedWeekIdx];
    const nextWeek = mesoData.weeks[nextIdx];
    const growthTargets = mesoData.growthTargets || {};

    // Growth is decided per SESSION, per MUSCLE — not aggregated across the
    // week — using that day's own feedback and that day's own credited sets
    // only. A muscle trained twice a week (e.g. triceps on Push A and Push B)
    // gets two fully independent decisions, each worth at most the normal
    // +1/+2 progressSets range, rather than one blended decision applied to
    // every exercise under that muscle regardless of which day it's on.
    //
    // Each earned delta lands on exactly ONE exercise in that session's
    // roster for that muscle: the meso-wide starred exercise (growthTargets),
    // if it's actually present that day; otherwise whichever exercise had the
    // most RIR headroom (actual RIR furthest above its target — the most room
    // to add more) among exercises with valid logged RIR. If nothing in the
    // session has positive headroom, the least-negative one still gets it —
    // growth doesn't silently vanish just because everyone was pushed hard.
    const growthByDayMuscle = completedWeek.days.map(day => {
      const dayExercises = day.exercises || [];
      const musclesToday = [...new Set(dayExercises.map(ex => ex.muscle))];
      const result = {};
      musclesToday.forEach(muscle => {
        const exercisesForMuscle = dayExercises.filter(ex => ex.muscle === muscle);
        const sessionTotal = exercisesForMuscle.reduce((sum, ex) => {
          const analyzed = analyzeSets(ex.sets);
          return sum + analyzed.reduce((s, a) => s + a.creditedValue, 0);
        }, 0);
        const feedback = day.feedback?.[muscle];
        const next = feedback ? progressSets(sessionTotal, feedback) : sessionTotal + 1;
        const delta = next - sessionTotal; // always a clean 0, 1, or 2
        if (delta <= 0) return;

        const starredId = growthTargets[muscle];
        let targetEx = starredId ? exercisesForMuscle.find(ex => ex.id === starredId) : null;
        if (!targetEx) {
          let bestHeadroom = -Infinity;
          exercisesForMuscle.forEach(ex => {
            const analyzed = analyzeSets(ex.sets);
            const calibrationSets = analyzed.filter(a => a.isCalibration).map(a => a.set);
            const actualRIRs = calibrationSets
              .filter(s => s.rirActual !== null && s.rirActual !== undefined)
              .map(s => s.rirActual);
            if (actualRIRs.length === 0) return; // no valid RIR logged — not eligible
            const avgActual = actualRIRs.reduce((a, b) => a + b, 0) / actualRIRs.length;
            const target = calibrationSets[0]?.rirTarget ?? ex.sets[0]?.rirTarget ?? 3;
            const headroom = avgActual - target;
            if (headroom > bestHeadroom) { bestHeadroom = headroom; targetEx = ex; }
          });
          if (!targetEx) targetEx = exercisesForMuscle[0]; // last resort: nobody had RIR logged
        }
        result[muscle] = { exerciseId: targetEx.id, delta };
      });
      return result;
    });

    // Build next week
    nextWeek.days.forEach((day, dIdx) => {
      const prevDay = completedWeek.days[dIdx];
      const dayGrowth = growthByDayMuscle[dIdx] || {};
      day.exercises = prevDay.exercises?.map(prevEx => {
        const muscle = prevEx.muscle;

        // Split this exercise's logged sets into calibration rows (straight
        // sets, and technique tags that don't change rest/load — cluster,
        // partials, forced, eccentric, occlusion) vs continuation rows
        // (myo-rep mini-sets, rest-pause, drop-set drops) that were reached
        // via abbreviated rest and so don't get a vote on weight calibration.
        const analyzed = analyzeSets(prevEx.sets);
        const creditedSetTotal = analyzed.reduce((sum, a) => sum + a.creditedValue, 0);
        const calibrationSets = analyzed.filter(a => a.isCalibration).map(a => a.set);

        // Compute this exercise's RIR data from calibration sets only
        const actualRIRs = calibrationSets
          .filter(s => s.rirActual !== null && s.rirActual !== undefined)
          .map(s => s.rirActual);
        const lastCalibrationSet = calibrationSets[calibrationSets.length - 1];
        const rirData = actualRIRs.length > 0 ? {
          avgActual: actualRIRs.reduce((a, b) => a + b, 0) / actualRIRs.length,
          target: calibrationSets[0]?.rirTarget ?? prevEx.sets[0]?.rirTarget ?? 3,
          lastWeight: lastCalibrationSet?.weight ?? null,
          lastReps: lastCalibrationSet?.reps ?? null,
        } : null;

        const targetRIR = getTargetRIR(nextIdx + 1, mesoData.weeks.length);

        // nextSetCount carries this exercise's own credited total forward
        // unchanged, plus whatever this session's (muscle, day) growth
        // decision above assigned specifically to THIS exercise — every
        // other exercise sharing the muscle that day gets +0 automatically.
        let nextSetCount;
        if (isDeload) {
          nextSetCount = Math.max(1, Math.floor(creditedSetTotal / 2));
        } else {
          const earned = dayGrowth[muscle]?.exerciseId === prevEx.id ? dayGrowth[muscle].delta : 0;
          nextSetCount = Math.max(1, Math.round(creditedSetTotal + earned));
        }

        // Weight suggestion
        let suggestedWeight = rirData?.lastWeight ?? 0;
        let weightNote = '';
        if (isDeload) {
          suggestedWeight = Math.round((rirData?.lastWeight ?? 0) * 0.6);
          weightNote = 'Deload — 60% of last';
        } else if (rirData) {
          const sugg = suggestWeightChange(rirData.avgActual, rirData.target, prevEx.assisted);
          if (sugg.direction !== 'hold') {
            suggestedWeight = Math.round(rirData.lastWeight * (1 + sugg.pct));
          }
          weightNote = sugg.msg;
        }

        // Calibration-count leading rows keep literal per-index stickiness
        // (occlusion/cluster/etc. tagged on a specific calibration set); any
        // row past that is a continuation slot and inherits this exercise's
        // sticky continuation technique (myo-rep/rest-pause/drop-set),
        // however many such slots this week's credited count actually
        // produces — see reconcileStickyTechniques above.
        const calibrationCount = calibrationSets.length;
        const continuationTechnique = mesoData.stickyTechniques?.[`${dIdx}:${prevEx.id}:continuation`] || null;

        return {
          ...prevEx,
          sets: Array(nextSetCount).fill(null).map((_, setIdx) => ({
            weight: suggestedWeight, reps: null, rirTarget: targetRIR, rirActual: null,
            technique: isDeload ? null : (
              setIdx < calibrationCount
                ? (mesoData.stickyTechniques?.[`${dIdx}:${prevEx.id}:${setIdx}`] || null)
                : continuationTechnique
            ),
          })),
          weightNote,
        };
      }) || [];
      // Same sync as handleDeletePermanent, now that this day has real
      // exercises: drop any muscle no longer represented (e.g. a REST OF
      // MESO delete that hit this day back when it was still ungenerated).
      if (day.muscles) {
        const remainingMuscles = new Set(day.exercises.map(e => e.muscle));
        day.muscles = day.muscles.filter(m => remainingMuscles.has(m));
      }
    });

    nextWeek.generated = true;
  };

  // ----- VIEW: SETUP -----
  if (view === 'setup') {
    return <MesoSetup prefs={prefs} setPrefs={setPrefs}
      customExercises={customExercises} setCustomExercises={setCustomExercises}
      exerciseVideos={exerciseVideos} setExerciseVideos={setExerciseVideos}
      onDeleteCustomExercise={deleteCustomExercise}
      onCancel={() => setView('home')}
      onCreate={(newMeso) => {
        // Archive whatever meso was active before this one — captures both
        // completed AND abandoned-partway mesos, since this fires on any
        // "start a new one" action regardless of prior completion state.
        if (meso) {
          setArchive(prev => [{ ...meso, archivedAt: new Date().toISOString() }, ...prev]);
        }
        setMeso(newMeso);
        setView('home');
      }} />;
  }

  // ----- VIEW: WORKOUT -----
  if (view === 'workout' && activeWorkout && meso) {
    const wk = meso.weeks[activeWorkout.weekIdx];
    const day = wk.days[activeWorkout.dayIdx];
    // Same day-slot, one week back — day-slot index is stable across weeks
    // (Push A is always days[0] in every week), so this is a valid "what did
    // I do last time" lookup. null in week 1 — nothing to compare against.
    const previousWeekDay = activeWorkout.weekIdx > 0
      ? meso.weeks[activeWorkout.weekIdx - 1]?.days?.[activeWorkout.dayIdx] || null
      : null;
    return <WorkoutLogger
      day={day} previousWeekDay={previousWeekDay}
      sessionKey={`${meso.id}:${activeWorkout.weekIdx}:${activeWorkout.dayIdx}`}
      weekNum={activeWorkout.weekIdx + 1} totalWeeks={meso.weeks.length}
      isDeload={activeWorkout.weekIdx === meso.weeks.length - 1}
      units={prefs.units}
      customExercises={customExercises} setCustomExercises={setCustomExercises}
      exerciseVideos={exerciseVideos} setExerciseVideos={setExerciseVideos}
      exerciseNotes={exerciseNotes} setExerciseNotes={setExerciseNotes}
      onDeleteCustomExercise={deleteCustomExercise}
      onSwapPermanent={handleSwapPermanent}
      onDeletePermanent={handleDeletePermanent}
      onAddPermanent={handleAddPermanent}
      onReorderPermanent={handleReorderPermanent}
      growthTargets={meso.growthTargets || {}}
      onSetGrowthTarget={handleSetGrowthTarget}
      onClearGrowthTarget={handleClearGrowthTarget}
      onComplete={completeWorkout} onCancel={() => { setActiveWorkout(null); setView('home'); }}
    />;
  }

  // ----- VIEW: WORKOUT VIEWER (read-only — logged sets/reps for a completed day) -----
  if (view === 'workoutView' && activeWorkout && meso) {
    const wk = meso.weeks[activeWorkout.weekIdx];
    const day = wk.days[activeWorkout.dayIdx];
    return <WorkoutViewer
      day={day} weekNum={activeWorkout.weekIdx + 1}
      onBack={() => { setActiveWorkout(null); setView('home'); }}
    />;
  }

  // ----- VIEW: SETTINGS -----
  if (view === 'settings') {
    return <SettingsView prefs={prefs} setPrefs={setPrefs}
      customExercises={customExercises}
      onManageCustom={() => setView('customExercises')}
      onResetAll={handleResetAllData}
      onSignOut={signOut}
      exportData={{
        meso: { _version: SCHEMA_VERSIONS.meso, data: meso },
        prefs: { _version: SCHEMA_VERSIONS.prefs, data: prefs },
        customExercises: { _version: SCHEMA_VERSIONS.customExercises, data: customExercises },
        exerciseVideos: { _version: SCHEMA_VERSIONS.exerciseVideos, data: exerciseVideos },
        exerciseNotes: { _version: SCHEMA_VERSIONS.exerciseNotes, data: exerciseNotes },
        archive: { _version: SCHEMA_VERSIONS.archive, data: archive },
      }}
      onBack={() => setView('home')} />;
  }

  // ----- VIEW: CUSTOM EXERCISES MANAGEMENT -----
  if (view === 'customExercises') {
    return <CustomExercisesView
      customExercises={customExercises} exerciseVideos={exerciseVideos}
      onDelete={deleteCustomExercise}
      onBack={() => setView('settings')} />;
  }

  // ----- VIEW: ARCHIVE -----
  if (view === 'archive') {
    return <ArchiveView archive={archive}
      units={prefs.units}
      onDeleteEntry={(archivedAt) => setArchive(prev => prev.filter(m => m.archivedAt !== archivedAt))}
      onBack={() => setView('home')} />;
  }

  // ----- VIEW: HOME / DASHBOARD -----
  return (
    <div className="min-h-screen bg-black text-zinc-100 pb-20">
      <style>{FONT_STYLE}</style>
      <Header
        view={view}
        onNavHome={() => setView('home')}
        onNavArchive={() => setView('archive')}
        onNavSettings={() => setView('settings')}
      />
      {!meso ? (
        <EmptyState onStart={() => setView('setup')} />
      ) : (
        <Dashboard meso={meso} prefs={prefs} onStartWorkout={startWorkout} onViewWorkout={viewWorkout}
          onNewMeso={() => setView('setup')}
          onDeleteMeso={() => { setMeso(null); }} />
      )}
    </div>
  );
}

// ============================================================================
// HEADER
// ============================================================================
function Header({ centerText, view, onNavHome, onNavArchive, onNavSettings }) {
  return (
    <div className="border-b border-zinc-800 px-5 py-4 sticky top-0 bg-black z-10">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-2 h-2 bg-amber-400 mono"></div>
          <span className="mono text-xs tracking-[0.2em] text-zinc-400">HYPER · LOG</span>
        </div>
        {centerText && (
          <div className="mono text-xs text-zinc-500 truncate flex-1 text-center">
            {centerText}
          </div>
        )}
        <div className="flex items-center gap-1 flex-shrink-0">
          {view !== 'home' && onNavHome && (
            <button onClick={onNavHome}
              className="text-zinc-400 hover:text-amber-400 w-8 h-8 flex items-center justify-center"
              title="Home">
              <Home className="w-4 h-4" />
            </button>
          )}
          {view !== 'archive' && onNavArchive && (
            <button onClick={onNavArchive}
              className="text-zinc-400 hover:text-amber-400 w-8 h-8 flex items-center justify-center"
              title="Archive">
              <Archive className="w-4 h-4" />
            </button>
          )}
          {view !== 'settings' && onNavSettings && (
            <button onClick={onNavSettings}
              className="text-zinc-400 hover:text-amber-400 w-8 h-8 flex items-center justify-center"
              title="Settings">
              <Settings className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


// ============================================================================
// EMPTY STATE
// ============================================================================
function EmptyState({ onStart }) {
  return (
    <div className="px-5 py-12 text-center">
      <Dumbbell className="w-12 h-12 mx-auto text-zinc-700 mb-6" strokeWidth={1.5} />
      <h1 className="text-3xl font-black tracking-tight mb-3">No active mesocycle</h1>
      <p className="text-zinc-500 text-sm mb-8 max-w-xs mx-auto leading-relaxed">
        Start a 4–6 week training block with periodized RIR-based progression.
      </p>
      <button onClick={onStart}
        className="bg-amber-400 text-black px-6 py-3 font-bold tracking-wide hover:bg-amber-300 transition-colors">
        START MESOCYCLE →
      </button>
    </div>
  );
}

// ============================================================================
// MESO SETUP
// ============================================================================
function MesoSetup({ prefs, setPrefs, customExercises, setCustomExercises, exerciseVideos, setExerciseVideos, onDeleteCustomExercise, onCreate, onCancel }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [mode, setMode] = useState('template'); // 'template' | 'custom'
  const [templateKey, setTemplateKey] = useState('upper-lower-4');
  const [customDaysPerWeek, setCustomDaysPerWeek] = useState(4);
  const [priorities, setPriorities] = useState(() => {
    const p = {};
    MUSCLE_GROUPS.forEach(m => p[m] = 'maintain');
    return p;
  });
  const [weeks, setWeeks] = useState(5);
  const [units, setUnits] = useState(prefs.units);
  // Per day: a flat, freely-orderable list of { muscle, exId } — muscle is metadata
  // on each entry (drives its dropdown options), not a boundary on where it can sit.
  const [selectedExercises, setSelectedExercises] = useState({});
  const [dayOrder, setDayOrder] = useState([]); // stable-id ordering for day display
  const [dayNameOverrides, setDayNameOverrides] = useState({}); // user-renamed day labels
  // Modal: either { mode: 'add_custom', muscle, dayIdx, exIdx } or { mode: 'edit_video', exerciseId, exerciseName, muscle }
  const [exerciseModalState, setExerciseModalState] = useState(null);

  // Resolve the effective video URL for any exercise — user override beats baked-in
  const getEffectiveVideoUrl = (ex) => {
    if (ex.id in exerciseVideos) return exerciseVideos[ex.id] || null;
    return ex.videoUrl || null;
  };

  // Merged exercise library: built-in + user-created custom exercises, both with overridden videoUrls.
  // When Home Gym Mode is ON with selected equipment, library exercises are filtered to match
  // available equipment. Custom exercises always shown (user knows they can do their own).
  const getMuscleExercises = (muscle) => {
    let library = (EXERCISES[muscle] || []).map(ex => ({ ...ex, videoUrl: getEffectiveVideoUrl(ex) }));
    if (prefs.homeGym && Array.isArray(prefs.equipment) && prefs.equipment.length > 0) {
      library = library.filter(ex => prefs.equipment.includes(ex.equipment));
    }
    const custom = (customExercises[muscle] || []).map(ex => ({ ...ex, videoUrl: getEffectiveVideoUrl(ex) }));
    return [...library, ...custom];
  };

  // Save handler for the "+ ADD CUSTOM EXERCISE" modal flow
  const handleCustomExerciseSave = (newExercise, videoUrl) => {
    if (!exerciseModalState || exerciseModalState.mode !== 'add_custom') return;
    const { muscle, dayIdx, flatIdx } = exerciseModalState;
    // Add to global custom library (without videoUrl — that lives in exerciseVideos)
    const customDef = { id: newExercise.id, name: newExercise.name, equipment: 'custom', isCustom: true, assisted: newExercise.assisted || false };
    setCustomExercises({
      ...customExercises,
      [muscle]: [...(customExercises[muscle] || []), customDef],
    });
    // Store video URL separately if provided
    if (videoUrl) {
      setExerciseVideos({ ...exerciseVideos, [newExercise.id]: videoUrl });
    }
    // Apply to the originating row
    const list = [...(selectedExercises[dayIdx] || [])];
    list[flatIdx] = { muscle, exId: newExercise.id };
    setSelectedExercises({ ...selectedExercises, [dayIdx]: list });
    setExerciseModalState(null);
  };

  // Save handler for editing the video URL on any existing exercise
  const handleVideoEditSave = (exerciseId, newUrl) => {
    const next = { ...exerciseVideos };
    if (newUrl) {
      next[exerciseId] = newUrl;
    } else {
      next[exerciseId] = null; // explicit removal (still tracked so it overrides any snapshot)
    }
    setExerciseVideos(next);
    setExerciseModalState(null);
  };

  // Delete a custom exercise from MesoSetup: app-level cleanup + replace local refs
  const handleDeleteCustomExerciseFromSetup = (exerciseId, muscle) => {
    onDeleteCustomExercise(exerciseId, muscle);
    // Replace any references in selectedExercises with the muscle's first library exercise
    const replacement = EXERCISES[muscle]?.[0]?.id;
    const nextSelected = { ...selectedExercises };
    Object.keys(nextSelected).forEach(dayIdx => {
      nextSelected[dayIdx] = (nextSelected[dayIdx] || []).map(entry =>
        entry.exId === exerciseId ? { ...entry, exId: replacement || entry.exId } : entry
      );
    });
    setSelectedExercises(nextSelected);
    setExerciseModalState(null);
  };

  // Derived: active days + muscles based on mode
  const activeDays = mode === 'template'
    ? TEMPLATES[templateKey].days
    : buildCustomDays(customDaysPerWeek, priorities);
  const activeMuscles = [...new Set(activeDays.flatMap(d => d.muscles))];

  // Initialize defaults per day — auto-rotate exercises when same muscle appears
  // on multiple days (e.g. chest on Push A gets bench, chest on Push B gets incline DB)
  useEffect(() => {
    const nextExercises = {};
    const muscleOccurrence = {};
    activeDays.forEach((day, dayIdx) => {
      nextExercises[dayIdx] = day.muscles.map(muscle => {
        const occurrenceIdx = muscleOccurrence[muscle] || 0;
        const exList = EXERCISES[muscle];
        muscleOccurrence[muscle] = occurrenceIdx + 1;
        return { muscle, exId: exList[occurrenceIdx % exList.length].id };
      });
    });
    setSelectedExercises(nextExercises);
    setDayOrder(activeDays.map((_, i) => i));
    setDayNameOverrides({});
    // eslint-disable-next-line
  }, [mode, templateKey, customDaysPerWeek, JSON.stringify(priorities)]);

  // Move a day up/down in the display order
  const moveDay = (fromDisplayIdx, direction) => {
    const order = dayOrder.length === activeDays.length ? [...dayOrder] : activeDays.map((_, i) => i);
    const toIdx = fromDisplayIdx + direction;
    if (toIdx < 0 || toIdx >= order.length) return;
    [order[fromDisplayIdx], order[toIdx]] = [order[toIdx], order[fromDisplayIdx]];
    setDayOrder(order);
  };

  // Compute the days to render in display order, each with its stable id
  const validOrder = dayOrder.length === activeDays.length && dayOrder.every(i => i >= 0 && i < activeDays.length)
    ? dayOrder : activeDays.map((_, i) => i);
  const displayDays = validOrder.map(stableIdx => ({ day: activeDays[stableIdx], stableIdx }));

  // Effective day name (override or default)
  const getDayName = (stableIdx) => {
    if (stableIdx in dayNameOverrides) return dayNameOverrides[stableIdx];
    return activeDays[stableIdx]?.name || '';
  };

  // Reorder / edit helpers — the day's exercises are one flat, freely-orderable
  // list; "muscle" on each entry is metadata (drives its dropdown options and
  // its chip grouping above), not a boundary on where the entry can sit.
  const moveExercise = (dayIdx, fromIdx, direction) => {
    const list = [...(selectedExercises[dayIdx] || [])];
    const toIdx = fromIdx + direction;
    if (toIdx < 0 || toIdx >= list.length) return;
    [list[fromIdx], list[toIdx]] = [list[toIdx], list[fromIdx]];
    setSelectedExercises({ ...selectedExercises, [dayIdx]: list });
  };
  const updateExerciseAt = (dayIdx, flatIdx, newId, muscle) => {
    // Special trigger: open custom-exercise modal for this slot
    if (newId === '__add_custom__') {
      setExerciseModalState({ mode: 'add_custom', muscle, dayIdx, flatIdx });
      return;
    }
    const list = [...(selectedExercises[dayIdx] || [])];
    list[flatIdx] = { ...list[flatIdx], exId: newId };
    setSelectedExercises({ ...selectedExercises, [dayIdx]: list });
  };
  const removeExerciseAt = (dayIdx, flatIdx) => {
    const list = selectedExercises[dayIdx] || [];
    const muscle = list[flatIdx]?.muscle;
    if (list.filter(e => e.muscle === muscle).length <= 1) return; // drop the muscle's chip instead
    setSelectedExercises({ ...selectedExercises, [dayIdx]: list.filter((_, i) => i !== flatIdx) });
  };
  // "+" on a muscle chip: append another exercise for that muscle to the end
  // of the list — reorder it into place afterward with the row's arrows.
  const addExerciseForMuscle = (dayIdx, muscle) => {
    const list = selectedExercises[dayIdx] || [];
    const usedIds = new Set(list.filter(e => e.muscle === muscle).map(e => e.exId));
    const unused = getMuscleExercises(muscle).find(e => !usedIds.has(e.id));
    if (!unused) return;
    setSelectedExercises({ ...selectedExercises, [dayIdx]: [...list, { muscle, exId: unused.id }] });
  };
  const addMuscleToDay = (dayIdx, muscle) => {
    const list = selectedExercises[dayIdx] || [];
    if (list.some(e => e.muscle === muscle)) return;
    setSelectedExercises({ ...selectedExercises, [dayIdx]: [...list, { muscle, exId: EXERCISES[muscle][0].id }] });
  };
  const removeMuscleFromDay = (dayIdx, muscle) => {
    const list = selectedExercises[dayIdx] || [];
    if (new Set(list.map(e => e.muscle)).size <= 1) return; // keep at least one muscle per day
    setSelectedExercises({ ...selectedExercises, [dayIdx]: list.filter(e => e.muscle !== muscle) });
  };


  // Priority counts for the summary line in custom mode
  const priorityCounts = MUSCLE_GROUPS.reduce((acc, m) => {
    const p = priorities[m];
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});
  const customValid = activeMuscles.length > 0 && activeDays.length > 0;

  const createMeso = () => {
    const generateWeek = (weekIdx) => {
      const isDeload = weekIdx === weeks - 1;
      const targetRIR = getTargetRIR(weekIdx + 1, weeks);
      return {
        weekNum: weekIdx + 1,
        isDeload,
        targetRIR,
        generated: weekIdx === 0,
        days: validOrder.map((stableIdx) => {
          const dayIdx = stableIdx;
          const d = activeDays[stableIdx];
          const flatList = selectedExercises[dayIdx]?.length
            ? selectedExercises[dayIdx]
            : d.muscles.map(muscle => ({ muscle, exId: EXERCISES[muscle][0].id }));
          const customName = dayNameOverrides[stableIdx]?.trim();
          return {
            name: customName || d.name,
            muscles: [...new Set(flatList.map(e => e.muscle))], // first-appearance order in the actual list
            completed: false,
            exercises: weekIdx === 0 ? flatList.map(({ muscle, exId }) => {
              const priority = mode === 'custom' ? priorities[muscle] : undefined;
              const startSets = getStartingSets(muscle, priority);
              const allEx = getMuscleExercises(muscle);
              const exMeta = allEx.find(e => e.id === exId) || allEx[0];
              return {
                id: exId,
                name: exMeta.name,
                muscle,
                assisted: exMeta.assisted || false,
                videoUrl: exMeta.videoUrl || null, // merged library populates this
                sets: Array(startSets).fill(null).map(() => ({
                  weight: 0, reps: null, rirTarget: targetRIR, rirActual: null, technique: null,
                })),
              };
            }) : [],
            feedback: null,
          };
        }),
      };
    };

    const meso = {
      id: Date.now(),
      name: name || `Meso ${new Date().toLocaleDateString()}`,
      mode,
      templateKey: mode === 'template' ? templateKey : null,
      customDaysPerWeek: mode === 'custom' ? customDaysPerWeek : null,
      priorities: mode === 'custom' ? priorities : null,
      units,
      startDate: new Date().toISOString(),
      growthTargets: {}, // meso-wide: { [muscle]: exerciseId } — starred growth exercise per muscle
      stickyTechniques: {}, // { "dayIdx:exerciseId:setIdx": techniqueKey } — auto-persisted set tags
      weeks: Array(weeks).fill(null).map((_, i) => generateWeek(i)),
    };

    setPrefs({ ...prefs, units });
    onCreate(meso);
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 pb-24">
      <style>{FONT_STYLE}</style>
      <Header />
      <div className="px-5 py-6">
        <div className="flex items-center justify-between mb-6">
          <button onClick={step === 1 ? onCancel : () => setStep(step - 1)}
            className="text-zinc-400 flex items-center gap-1 text-sm">
            <ChevronLeft className="w-4 h-4" /> {step === 1 ? 'Cancel' : 'Back'}
          </button>
          <span className="mono text-xs text-zinc-500">STEP {step} / 2</span>
        </div>

        {step === 1 && (
          <>
            <h2 className="text-2xl font-black mb-1">Configure block</h2>
            <p className="text-zinc-500 text-sm mb-6">Length, units, and how the program's built.</p>

            <Field label="MESO NAME">
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="Spring Push '26"
                className="w-full bg-zinc-900 border border-zinc-800 px-3 py-3 text-white focus:border-amber-400 outline-none" />
            </Field>

            <Field label="LENGTH (WEEKS — LAST IS DELOAD)">
              <div className="grid grid-cols-3 gap-2">
                {[4, 5, 6].map(w => (
                  <button key={w} onClick={() => setWeeks(w)}
                    className={`py-3 mono font-bold border ${weeks === w ? 'bg-amber-400 text-black border-amber-400' : 'bg-zinc-900 border-zinc-800 text-zinc-400'}`}>
                    {w}
                  </button>
                ))}
              </div>
              {weeks === 4 && <p className="text-xs text-amber-400/70 mt-2 mono">⚠ 4w may be too short for intermediates</p>}
            </Field>

            <Field label="UNITS">
              <div className="grid grid-cols-2 gap-2">
                {['lbs', 'kg'].map(u => (
                  <button key={u} onClick={() => setUnits(u)}
                    className={`py-3 mono font-bold uppercase border ${units === u ? 'bg-amber-400 text-black border-amber-400' : 'bg-zinc-900 border-zinc-800 text-zinc-400'}`}>
                    {u}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="PROGRAM BUILD MODE">
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setMode('template')}
                  className={`p-4 border text-left ${mode === 'template' ? 'bg-amber-400/10 border-amber-400' : 'bg-zinc-900 border-zinc-800'}`}>
                  <div className="font-bold mb-1">Template</div>
                  <div className="mono text-[10px] text-zinc-500 tracking-wider">PROVEN SPLIT</div>
                </button>
                <button onClick={() => setMode('custom')}
                  className={`p-4 border text-left ${mode === 'custom' ? 'bg-amber-400/10 border-amber-400' : 'bg-zinc-900 border-zinc-800'}`}>
                  <div className="font-bold mb-1">Custom</div>
                  <div className="mono text-[10px] text-zinc-500 tracking-wider">BY PRIORITY</div>
                </button>
              </div>
            </Field>

            {mode === 'template' && (
              <Field label="TEMPLATE">
                <div className="space-y-2">
                  {Object.entries(TEMPLATES).map(([key, tpl]) => (
                    <button key={key} onClick={() => setTemplateKey(key)}
                      className={`w-full text-left p-4 border ${templateKey === key ? 'bg-zinc-900 border-amber-400' : 'bg-zinc-900 border-zinc-800'}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-bold">{tpl.name}</div>
                          <div className="text-xs text-zinc-500 mono mt-1">{tpl.daysPerWeek} DAYS/WK · {tpl.days.length} ROTATING</div>
                        </div>
                        {templateKey === key && <Check className="w-5 h-5 text-amber-400" />}
                      </div>
                    </button>
                  ))}
                </div>
              </Field>
            )}

            {mode === 'custom' && (
              <>
                <Field label="DAYS PER WEEK">
                  <div className="grid grid-cols-4 gap-2">
                    {[3, 4, 5, 6].map(d => (
                      <button key={d} onClick={() => setCustomDaysPerWeek(d)}
                        className={`py-3 mono font-bold border ${customDaysPerWeek === d ? 'bg-amber-400 text-black border-amber-400' : 'bg-zinc-900 border-zinc-800 text-zinc-400'}`}>
                        {d}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="MUSCLE PRIORITIES">
                  <p className="text-[10px] text-zinc-500 mb-3 mono tracking-wider">
                    OFF = SKIP ENTIRELY · MAIN = MINIMAL · EMPH = HIGHER VOLUME
                  </p>
                  <div className="space-y-1.5">
                    {MUSCLE_GROUPS.map(muscle => (
                      <div key={muscle} className="grid grid-cols-5 gap-1 items-center">
                        <div className="col-span-2 mono text-[11px] tracking-widest text-zinc-300">
                          {muscle.toUpperCase()}
                        </div>
                        <PriorityBtn current={priorities[muscle]} value="ignore"
                          onClick={() => setPriorities({ ...priorities, [muscle]: 'ignore' })}>
                          OFF
                        </PriorityBtn>
                        <PriorityBtn current={priorities[muscle]} value="maintain"
                          onClick={() => setPriorities({ ...priorities, [muscle]: 'maintain' })}>
                          MAIN
                        </PriorityBtn>
                        <PriorityBtn current={priorities[muscle]} value="emphasize"
                          onClick={() => setPriorities({ ...priorities, [muscle]: 'emphasize' })}>
                          EMPH
                        </PriorityBtn>
                      </div>
                    ))}
                  </div>

                  {/* Priority summary */}
                  <div className="mt-4 px-3 py-2.5 bg-zinc-950 border border-zinc-800 mono text-[10px] tracking-widest text-zinc-500 flex justify-between">
                    <span>OFF <span className="text-zinc-600">{priorityCounts.ignore || 0}</span></span>
                    <span>MAIN <span className="text-zinc-100">{priorityCounts.maintain || 0}</span></span>
                    <span>EMPH <span className="text-amber-400">{priorityCounts.emphasize || 0}</span></span>
                    <span>ACTIVE DAYS <span className="text-amber-400">{activeDays.length}</span></span>
                  </div>

                  {!customValid && (
                    <p className="text-red-400 mono text-[10px] mt-3 tracking-widest">
                      ⚠ AT LEAST ONE MUSCLE MUST BE EMPH OR MAIN
                    </p>
                  )}
                </Field>
              </>
            )}

            <button onClick={() => setStep(2)}
              disabled={mode === 'custom' && !customValid}
              className="w-full bg-amber-400 text-black py-4 font-bold tracking-wide mt-6 disabled:opacity-30 disabled:cursor-not-allowed">
              CHOOSE EXERCISES →
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-2xl font-black mb-1">Pick exercises</h2>
            <p className="text-zinc-500 text-sm mb-6">
              One per muscle per day{mode === 'custom' && <span className="text-amber-400"> · ★ = emphasized</span>}
            </p>

            {displayDays.map(({ day, stableIdx }, displayIdx) => {
              const dayIdx = stableIdx; // alias: all per-day state is keyed by the stable id
              const dayExerciseList = selectedExercises[dayIdx] || [];
              // Muscles present, in first-appearance order — falls back to the split's
              // default list only in the brief window before the seed effect has run.
              const activeMusclesForDay = dayExerciseList.length
                ? [...new Set(dayExerciseList.map(e => e.muscle))]
                : day.muscles;
              const availableToAdd = MUSCLE_GROUPS.filter(m => !activeMusclesForDay.includes(m));
              return (
              <div key={stableIdx} className="mb-8">
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-zinc-800 gap-2">
                  <div className="flex items-baseline gap-2 flex-1 min-w-0">
                    <span className="mono text-xs tracking-[0.2em] text-amber-400 whitespace-nowrap">DAY {displayIdx + 1} —</span>
                    <input
                      type="text"
                      value={stableIdx in dayNameOverrides ? dayNameOverrides[stableIdx] : day.name}
                      onChange={e => setDayNameOverrides({ ...dayNameOverrides, [stableIdx]: e.target.value })}
                      onFocus={e => e.target.select()}
                      maxLength={24}
                      placeholder={day.name}
                      className="flex-1 mono text-xs tracking-[0.15em] text-amber-400 bg-transparent border-b border-dashed border-amber-400/30 focus:border-amber-400 outline-none px-1 uppercase min-w-0"
                    />
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="mono text-[10px] tracking-widest text-zinc-500 whitespace-nowrap">
                      {activeMusclesForDay.length} MUSCLES
                    </span>
                    {displayDays.length > 1 && (
                      <div className="flex">
                        <button onClick={() => moveDay(displayIdx, -1)} disabled={displayIdx === 0}
                          className="bg-zinc-900 border border-zinc-800 w-7 h-7 flex items-center justify-center text-zinc-500 disabled:opacity-20"
                          title="Move day up">
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => moveDay(displayIdx, 1)} disabled={displayIdx === displayDays.length - 1}
                          className="bg-zinc-900 border border-zinc-800 border-l-0 w-7 h-7 flex items-center justify-center text-zinc-500 disabled:opacity-20"
                          title="Move day down">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Muscle chips — which muscles this day trains. Purely a management
                    control now; position here is cosmetic and doesn't drive the
                    exercise sequence below (that's what the arrows on each row do). */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {activeMusclesForDay.map(muscle => {
                    const isEmph = mode === 'custom' && priorities[muscle] === 'emphasize';
                    const usedCount = dayExerciseList.filter(e => e.muscle === muscle).length;
                    const canAddMore = usedCount < getMuscleExercises(muscle).length;
                    return (
                      <div key={muscle} className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 pl-2.5 pr-1.5 py-1.5">
                        <span className="mono text-[10px] tracking-widest text-zinc-300">
                          {muscle.toUpperCase()}{isEmph && ' ★'}
                        </span>
                        <button onClick={() => addExerciseForMuscle(dayIdx, muscle)}
                          disabled={!canAddMore}
                          title={canAddMore ? `Add another ${muscle} exercise` : 'Every library exercise for this muscle is already added'}
                          className="text-zinc-500 hover:text-amber-400 disabled:opacity-20 disabled:cursor-not-allowed w-4 h-4 flex items-center justify-center">
                          <Plus className="w-3 h-3" />
                        </button>
                        <button onClick={() => removeMuscleFromDay(dayIdx, muscle)}
                          disabled={activeMusclesForDay.length <= 1}
                          title={activeMusclesForDay.length <= 1 ? 'Add another muscle to this day first' : `Remove ${muscle} from this day`}
                          className="text-zinc-500 hover:text-red-400 disabled:opacity-20 disabled:cursor-not-allowed w-4 h-4 flex items-center justify-center">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                  {availableToAdd.length > 0 && (
                    <select
                      value=""
                      onChange={e => { if (e.target.value) addMuscleToDay(dayIdx, e.target.value); }}
                      className="bg-zinc-950 border border-dashed border-zinc-700 px-2.5 py-1.5 text-amber-400/80 text-[10px] mono tracking-widest hover:border-amber-400/60 hover:text-amber-400 focus:border-amber-400 outline-none cursor-pointer"
                    >
                      <option value="" disabled>+ ADD MUSCLE</option>
                      {availableToAdd.map(m => (
                        <option key={m} value={m}>{m.toUpperCase()}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Flat, freely-orderable exercise list — this order is the actual
                    day sequence. The tag on each row is metadata, not a section. */}
                <div className="space-y-2">
                  {dayExerciseList.map((entry, flatIdx) => {
                    const { muscle, exId } = entry;
                    const exLibrary = getMuscleExercises(muscle);
                    const exMeta = exLibrary.find(e => e.id === exId);
                    const hasVideo = !!exMeta?.videoUrl;
                    const exName = exMeta?.name || 'Unknown';
                    const exIsCustom = !!exMeta?.isCustom;
                    const muscleCount = dayExerciseList.filter(e => e.muscle === muscle).length;
                    return (
                      <div key={flatIdx} className="flex gap-1">
                        <div className="w-11 flex-shrink-0 flex items-center justify-center bg-zinc-950 border border-zinc-800 mono text-[9px] tracking-wider text-zinc-500"
                          title={muscle.toUpperCase()}>
                          {muscle.slice(0, 3).toUpperCase()}
                        </div>
                        <select value={exId}
                          onChange={e => updateExerciseAt(dayIdx, flatIdx, e.target.value, muscle)}
                          className="flex-1 bg-zinc-900 border border-zinc-800 px-3 py-3 text-white focus:border-amber-400 outline-none min-w-0">
                          {exLibrary.map(ex => (
                            <option key={ex.id} value={ex.id}>
                              {ex.name}{ex.equipment ? ` (${ex.equipment})` : ''}{ex.assisted ? ' · ASSISTED' : ''}{ex.isCustom ? ' ✦' : ''}{ex.videoUrl ? ' ▶' : ''}
                            </option>
                          ))}
                          <option value="__add_custom__">+ ADD CUSTOM EXERCISE…</option>
                        </select>
                        <button onClick={() => moveExercise(dayIdx, flatIdx, -1)} disabled={flatIdx === 0}
                          className="bg-zinc-900 border border-zinc-800 w-9 text-zinc-500 disabled:opacity-20 flex items-center justify-center"
                          title="Move up">
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => moveExercise(dayIdx, flatIdx, 1)} disabled={flatIdx === dayExerciseList.length - 1}
                          className="bg-zinc-900 border border-zinc-800 w-9 text-zinc-500 disabled:opacity-20 flex items-center justify-center"
                          title="Move down">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => removeExerciseAt(dayIdx, flatIdx)}
                          disabled={muscleCount <= 1}
                          title={muscleCount <= 1 ? 'Remove the muscle chip above to drop this entirely' : 'Remove'}
                          className="bg-zinc-900 border border-zinc-800 w-9 text-zinc-500 hover:text-red-400 disabled:opacity-20 disabled:cursor-not-allowed flex items-center justify-center">
                          <X className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setExerciseModalState({
                            mode: 'edit_video',
                            exerciseId: exId,
                            exerciseName: exName,
                            muscle,
                            isCustom: exIsCustom,
                          })}
                          className="bg-amber-400 border border-amber-400 w-9 flex items-center justify-center hover:bg-amber-300"
                          title={hasVideo ? 'Edit / remove video link' : 'Add video link'}>
                          <Play className="w-3.5 h-3.5 text-red-600" fill={hasVideo ? 'none' : 'currentColor'} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })}

            <button onClick={createMeso}
              className="w-full bg-amber-400 text-black py-4 font-bold tracking-wide mt-6">
              CREATE MESOCYCLE →
            </button>
          </>
        )}
      </div>
      {exerciseModalState && (
        <ExerciseModal
          state={exerciseModalState}
          initialVideoUrl={exerciseModalState.mode === 'edit_video' ? (exerciseVideos[exerciseModalState.exerciseId] || '') : ''}
          onSaveCustom={handleCustomExerciseSave}
          onSaveVideo={handleVideoEditSave}
          onDeleteExercise={handleDeleteCustomExerciseFromSetup}
          onCancel={() => setExerciseModalState(null)}
        />
      )}
    </div>
  );
}

function ExerciseModal({ state, initialVideoUrl, initialNote, onSaveCustom, onSaveVideo, onSaveNote, onDeleteExercise, onCancel }) {
  const isAddCustom = state.mode === 'add_custom';
  const isEditNote = state.mode === 'edit_note';
  const isEditVideo = state.mode === 'edit_video';
  const canDelete = !isAddCustom && !isEditNote && state.isCustom && !!onDeleteExercise;
  const [name, setName] = useState('');
  const [assisted, setAssisted] = useState(false);
  const [videoUrl, setVideoUrl] = useState(initialVideoUrl || '');
  const [note, setNote] = useState(initialNote || '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const trimmedName = name.trim();
  const trimmedUrl = videoUrl.trim();
  const trimmedNote = note.trim();
  const urlValid = !trimmedUrl || /^https?:\/\//i.test(trimmedUrl);
  const canSave = isAddCustom
    ? (!!trimmedName && urlValid)
    : isEditNote
      ? true  // notes always saveable (empty note = removal)
      : urlValid;

  // Auto-revert delete confirm after 3s
  useEffect(() => {
    if (!confirmingDelete) return;
    const t = setTimeout(() => setConfirmingDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmingDelete]);

  const handleSave = () => {
    if (!canSave) return;
    if (isAddCustom) {
      const newExercise = {
        id: `custom-${Date.now()}`,
        name: trimmedName,
        assisted,
      };
      onSaveCustom(newExercise, trimmedUrl);
    } else if (isEditNote) {
      if (onSaveNote) onSaveNote(state.exerciseId, trimmedNote);
    } else {
      onSaveVideo(state.exerciseId, trimmedUrl);
    }
  };

  const handleDeleteClick = () => {
    if (confirmingDelete) {
      onDeleteExercise(state.exerciseId, state.muscle);
    } else {
      setConfirmingDelete(true);
    }
  };

  const modalTitle = isAddCustom ? 'Add Custom Exercise'
    : isEditNote ? 'Edit Notes'
    : 'Edit Video Link';

  return (
    <div className="fixed inset-0 bg-black/85 z-50 flex items-end sm:items-center justify-center px-4 py-4"
      onClick={onCancel}>
      <style>{FONT_STYLE}</style>
      <div className="bg-zinc-950 border border-zinc-800 max-w-md w-full"
        onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-zinc-800 flex items-start justify-between">
          <div>
            <h3 className="font-black text-lg tracking-tight">
              {modalTitle}
            </h3>
            <p className="mono text-[10px] text-zinc-500 tracking-widest mt-1">
              {isAddCustom ? state.muscle.toUpperCase() : `${state.exerciseName.toUpperCase()} · ${state.muscle.toUpperCase()}`}
            </p>
          </div>
          <button onClick={onCancel} className="text-zinc-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-5">
          {isAddCustom && (
            <div>
              <label className="mono text-[10px] tracking-widest text-zinc-500 mb-2 block">EXERCISE TITLE *</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g., Smith Machine Bench" autoFocus maxLength={60}
                className="w-full bg-zinc-900 border border-zinc-800 px-3 py-3 text-white focus:border-amber-400 outline-none" />
              <label className="flex items-start gap-2 mt-3 cursor-pointer">
                <input type="checkbox" checked={assisted} onChange={e => setAssisted(e.target.checked)}
                  className="mt-1 w-4 h-4 accent-amber-400" />
                <span className="mono text-[10px] tracking-wider text-zinc-400 leading-relaxed">
                  ASSISTED — the number on this machine is counterbalance, not resistance
                  (assist-machine dip/pull-up). Flips weight-suggestion direction.
                </span>
              </label>
            </div>
          )}
          {isEditNote ? (
            <div>
              <label className="mono text-[10px] tracking-widest text-zinc-500 mb-2 block">
                NOTES
              </label>
              <textarea value={note} onChange={e => setNote(e.target.value)}
                placeholder={`e.g.\nSeat: notch 4\nBack rest: notch 2\nFoot platform: middle\nMind cue: drive through heels`}
                autoFocus rows={8} maxLength={1000}
                className="w-full bg-zinc-900 border border-zinc-800 px-3 py-3 text-white focus:border-amber-400 outline-none mono text-sm resize-y" />
              <p className="text-zinc-600 mono text-[10px] tracking-wider mt-2 leading-relaxed">
                EQUIPMENT SETTINGS · TECHNIQUE CUES · ANYTHING WORTH REMEMBERING NEXT SESSION · LEAVE EMPTY TO REMOVE
              </p>
            </div>
          ) : (
            <div>
              <label className="mono text-[10px] tracking-widest text-zinc-500 mb-2 block">
                VIDEO LINK {isAddCustom && '(OPTIONAL)'}
              </label>
              <input type="url" value={videoUrl} onChange={e => setVideoUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=…" autoFocus={isEditVideo}
                className="w-full bg-zinc-900 border border-zinc-800 px-3 py-3 text-white focus:border-amber-400 outline-none" />
              {!urlValid && (
                <p className="text-red-400 mono text-[10px] tracking-widest mt-2">⚠ MUST START WITH HTTP:// OR HTTPS://</p>
              )}
              <p className="text-zinc-600 mono text-[10px] tracking-wider mt-2">
                {isAddCustom
                  ? 'SHOWN AS ▶ VIDEO BUTTON DURING WORKOUT · PASTE ANY VIDEO URL'
                  : 'LEAVE EMPTY TO REMOVE THE EXISTING LINK'}
              </p>
            </div>
          )}
          {canDelete && (
            <div className="pt-3 border-t border-zinc-800">
              <button onClick={handleDeleteClick}
                className={`w-full py-3 mono text-xs tracking-widest font-bold border ${confirmingDelete ? 'bg-red-500 border-red-500 text-white' : 'bg-zinc-900 border-red-900 text-red-400 hover:bg-red-950'}`}>
                {confirmingDelete ? 'TAP AGAIN TO CONFIRM DELETE' : '× DELETE CUSTOM EXERCISE'}
              </button>
              <p className="text-zinc-600 mono text-[10px] tracking-wider mt-2 text-center">
                {confirmingDelete
                  ? 'CONFIRMS IN 3S · ANY SLOT USING THIS EXERCISE WILL FALL BACK TO LIBRARY DEFAULT'
                  : 'REMOVES FROM YOUR CUSTOM LIBRARY · EXISTING WORKOUT SNAPSHOTS PRESERVED'}
              </p>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 p-5 border-t border-zinc-800">
          <button onClick={onCancel}
            className="bg-zinc-900 border border-zinc-800 py-3 text-zinc-300 mono text-xs tracking-widest">
            CANCEL
          </button>
          <button onClick={handleSave} disabled={!canSave}
            className="bg-amber-400 text-black py-3 font-bold mono text-xs tracking-widest disabled:opacity-30 disabled:cursor-not-allowed">
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

function PriorityBtn({ current, value, onClick, children }) {
  const active = current === value;
  const styles = {
    emphasize: active ? 'bg-amber-400 text-black border-amber-400' : 'bg-zinc-900 border-zinc-800 text-zinc-500',
    maintain: active ? 'bg-zinc-100 text-black border-zinc-100' : 'bg-zinc-900 border-zinc-800 text-zinc-500',
    ignore: active ? 'bg-zinc-700 text-zinc-300 border-zinc-700' : 'bg-zinc-900 border-zinc-800 text-zinc-500',
  };
  return (
    <button onClick={onClick} className={`py-2 mono text-[10px] tracking-widest border font-bold ${styles[value]}`}>
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <div className="mb-5">
      <label className="mono text-xs tracking-[0.15em] text-zinc-500 block mb-2">{label}</label>
      {children}
    </div>
  );
}

// ============================================================================
// DASHBOARD
// ============================================================================
function Dashboard({ meso, prefs, onStartWorkout, onViewWorkout, onNewMeso, onDeleteMeso }) {
  const [expandedWeek, setExpandedWeek] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Find current week (first week with incomplete day)
  let currentWeekIdx = meso.weeks.findIndex(w => w.days.some(d => !d.completed));
  if (currentWeekIdx === -1) currentWeekIdx = meso.weeks.length - 1;

  useEffect(() => { setExpandedWeek(currentWeekIdx); }, [currentWeekIdx]);

  // Stats
  const totalSetsLogged = meso.weeks.reduce((acc, w) =>
    acc + w.days.reduce((da, d) => da + (d.exercises?.reduce((ea, e) =>
      ea + e.sets.filter(s => s.reps !== null).length, 0) || 0), 0), 0);
  const totalSessions = meso.weeks.reduce((acc, w) => acc + w.days.length, 0);
  const completedSessions = meso.weeks.reduce((acc, w) => acc + w.days.filter(d => d.completed).length, 0);

  // Greeting + date
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 5 ? 'Late night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 21 ? 'Good evening' : 'Good night';
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  // Find next session — first incomplete day in current week
  const currentWeek = meso.weeks[currentWeekIdx];
  const nextDayIdx = currentWeek?.days.findIndex(d => !d.completed) ?? -1;
  const nextDay = nextDayIdx >= 0 ? currentWeek.days[nextDayIdx] : null;
  const isDeloadWeek = currentWeek?.isDeload;

  return (
    <div>
      {/* GREETING STRIP */}
      <div className="px-5 pt-6">
        <p className="mono text-[10px] tracking-[0.2em] text-zinc-500 mb-1">{dateStr.toUpperCase()}</p>
        <h1 className="text-2xl font-black tracking-tight text-zinc-100">{greeting}.</h1>
      </div>

      {/* HERO MESO CARD */}
      <div className="px-5 mt-6">
        <div className="border border-zinc-800 bg-zinc-950 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="mono text-[10px] tracking-[0.2em] text-amber-400">ACTIVE MESOCYCLE</div>
            <button onClick={() => setShowInfo(!showInfo)} className="text-zinc-500 hover:text-zinc-300">
              <Info className="w-4 h-4" />
            </button>
          </div>
          <h2 className="text-3xl font-black tracking-tight mb-3 leading-tight">{meso.name}</h2>

          <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-zinc-800">
            <Stat label="WEEK" value={`${currentWeekIdx + 1}/${meso.weeks.length}`} accent={isDeloadWeek ? 'sky' : 'amber'} />
            <Stat label="SESSIONS" value={`${completedSessions}/${totalSessions}`} />
            <Stat label="SETS" value={totalSetsLogged} />
          </div>

          {nextDay && (
            <button onClick={() => onStartWorkout(nextDayIdx, currentWeekIdx)}
              className="w-full mt-5 bg-amber-400 text-black py-3 px-4 flex items-center justify-between hover:bg-amber-300 transition-colors">
              <div className="text-left">
                <div className="mono text-[10px] tracking-[0.2em] opacity-70">{isDeloadWeek ? 'DELOAD · NEXT SESSION' : 'NEXT SESSION'}</div>
                <div className="text-base font-bold tracking-tight">{nextDay.name}</div>
              </div>
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
          {!nextDay && (
            <div className="w-full mt-5 border border-emerald-900 bg-emerald-950/30 py-3 px-4 mono text-xs tracking-widest text-emerald-400 text-center">
              ✓ MESOCYCLE COMPLETE
            </div>
          )}
        </div>

        {showInfo && <div className="mt-3"><RIRInfoBox onClose={() => setShowInfo(false)} /></div>}
      </div>

      {/* SCHEDULE */}
      <div className="px-5 mt-8">
        <h3 className="mono text-xs tracking-[0.2em] text-zinc-400 mb-3">SCHEDULE</h3>
        <div className="space-y-2">
          {meso.weeks.map((wk, wIdx) => (
            <WeekCard key={wIdx} week={wk} weekIdx={wIdx}
              isCurrent={wIdx === currentWeekIdx}
              isPast={wIdx < currentWeekIdx}
              expanded={expandedWeek === wIdx}
              onToggle={() => setExpandedWeek(expandedWeek === wIdx ? null : wIdx)}
              onStartWorkout={onStartWorkout}
              onViewWorkout={onViewWorkout}
              units={prefs.units}
            />
          ))}
        </div>
      </div>

      {/* FOOTER ACTIONS */}
      <div className="px-5 mt-8 pt-6 border-t border-zinc-900 flex gap-2">
        <button onClick={onNewMeso}
          className="flex-1 bg-zinc-900 border border-zinc-800 py-3 text-zinc-300 mono text-xs tracking-widest hover:border-zinc-600">
          NEW MESO
        </button>
        <button onClick={() => setConfirmingDelete(true)}
          className="bg-zinc-900 border border-zinc-800 py-3 px-4 text-red-400 hover:bg-red-950">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {confirmingDelete && (
        <ConfirmModal
          title="DELETE MESOCYCLE"
          message={<>This will permanently delete <span className="font-bold text-white">{meso.name}</span> and all logged data. This cannot be undone.</>}
          confirmLabel="DELETE"
          danger
          onConfirm={() => { setConfirmingDelete(false); onDeleteMeso(); }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}

function Stat({ label, value, accent = 'zinc' }) {
  const valueColor = accent === 'sky' ? 'text-sky-400' : accent === 'amber' ? 'text-amber-400' : 'text-zinc-100';
  return (
    <div>
      <div className="mono text-[9px] tracking-[0.2em] text-zinc-500 mb-1">{label}</div>
      <div className={`mono text-xl font-bold ${valueColor}`}>{value}</div>
    </div>
  );
}

function WeekCard({ week, weekIdx, isCurrent, isPast, expanded, onToggle, onStartWorkout, onViewWorkout, units }) {
  const completedDays = week.days.filter(d => d.completed).length;
  const totalDays = week.days.length;

  return (
    <div className={`border ${isCurrent ? 'border-amber-400/60' : week.isDeload ? 'border-sky-900' : 'border-zinc-800'}`}>
      <button onClick={onToggle} className="w-full flex items-center justify-between p-4 text-left">
        <div className="flex items-center gap-3">
          <div className={`mono text-2xl font-black ${isCurrent ? 'text-amber-400' : week.isDeload ? 'text-sky-400' : 'text-zinc-500'}`}>
            W{weekIdx + 1}
          </div>
          <div>
            <div className="font-bold text-sm">
              {week.isDeload ? 'DELOAD' : `Target RIR ${week.targetRIR}`}
            </div>
            <div className="mono text-xs text-zinc-500 mt-0.5">
              {completedDays}/{totalDays} sessions · {week.generated ? 'READY' : 'PENDING'}
            </div>
          </div>
        </div>
        <ChevronRight className={`w-4 h-4 text-zinc-600 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && week.generated && (
        <div className="border-t border-zinc-900 px-4 py-3 space-y-2">
          {week.days.map((day, dIdx) => (
            <div key={dIdx} className="flex items-center justify-between gap-2 py-2">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {day.completed ? (
                  <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                ) : (
                  <div className="w-4 h-4 border border-zinc-700 flex-shrink-0"></div>
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{day.name}</div>
                  <div className="mono text-[10px] text-zinc-500 tracking-wider">
                    {day.exercises.map(ex => ex.muscle.slice(0, 3).toUpperCase()).join(' ·\u00A0')}
                  </div>
                </div>
              </div>
              {!day.completed && isCurrent && (
                <button onClick={() => onStartWorkout(dIdx, weekIdx)}
                  className="bg-amber-400 text-black px-3 py-1.5 mono text-xs font-bold tracking-wider flex-shrink-0">
                  START →
                </button>
              )}
              {day.completed && (
                onViewWorkout ? (
                  <button onClick={() => onViewWorkout(dIdx, weekIdx)}
                    className="bg-zinc-900 border border-zinc-800 text-zinc-400 px-3 py-1.5 mono text-xs font-bold tracking-wider hover:border-emerald-700 hover:text-emerald-400 flex-shrink-0">
                    LOGGED →
                  </button>
                ) : (
                  <div className="mono text-[10px] text-zinc-600 flex-shrink-0">LOGGED</div>
                )
              )}
            </div>
          ))}
        </div>
      )}
      {expanded && !week.generated && (
        <div className="border-t border-zinc-900 px-4 py-4 text-xs mono text-zinc-500">
          GENERATED AFTER PRIOR WEEK COMPLETES
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ARCHIVE — list + detail view of completed/replaced mesocycles.
// Reuses WeekCard for the detail render (read-only: isCurrent=false on every
// week suppresses the "START →" buttons since those are gated behind isCurrent).
// ============================================================================
function ArchiveView({ archive, units, onDeleteEntry, onBack }) {
  const [openId, setOpenId] = useState(null); // archivedAt of the expanded entry, or null
  const [expandedWeek, setExpandedWeek] = useState(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);

  const toggleOpen = (archivedAt) => {
    const opening = openId !== archivedAt;
    setOpenId(opening ? archivedAt : null);
    setExpandedWeek(null); // reset week accordion whenever switching mesos
  };

  if (archive.length === 0) {
    return (
      <div className="min-h-screen bg-black text-zinc-100">
        <style>{FONT_STYLE}</style>
        <div className="border-b border-zinc-800 px-5 py-4 sticky top-0 bg-black z-10 flex items-center gap-3">
          <button onClick={onBack} className="text-zinc-400 flex items-center gap-1 text-sm">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <span className="mono text-xs tracking-[0.2em] text-zinc-400 ml-2">ARCHIVE</span>
        </div>
        <div className="px-5 py-12 text-center">
          <Archive className="w-12 h-12 mx-auto text-zinc-700 mb-6" strokeWidth={1.5} />
          <h1 className="text-2xl font-black tracking-tight mb-3">No history yet</h1>
          <p className="text-zinc-500 text-sm max-w-xs mx-auto leading-relaxed">
            Completed and replaced mesocycles land here automatically once you start a new one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-zinc-100 pb-12">
      <style>{FONT_STYLE}</style>
      <div className="border-b border-zinc-800 px-5 py-4 sticky top-0 bg-black z-10 flex items-center gap-3">
        <button onClick={onBack} className="text-zinc-400 flex items-center gap-1 text-sm">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <span className="mono text-xs tracking-[0.2em] text-zinc-400 ml-2">ARCHIVE</span>
      </div>
      <div className="px-5 py-6">
        <h2 className="text-2xl font-black tracking-tight mb-1">Training history</h2>
        <p className="text-zinc-500 text-sm mb-6">
          {archive.length} past mesocycle{archive.length === 1 ? '' : 's'}
        </p>

        <div className="space-y-2">
          {archive.map((m) => {
            const isOpen = openId === m.archivedAt;
            const totalSetsLogged = m.weeks.reduce((acc, w) =>
              acc + w.days.reduce((da, d) => da + (d.exercises?.reduce((ea, e) =>
                ea + e.sets.filter(s => s.reps !== null).length, 0) || 0), 0), 0);
            const totalSessions = m.weeks.reduce((acc, w) => acc + w.days.length, 0);
            const completedSessions = m.weeks.reduce((acc, w) => acc + w.days.filter(d => d.completed).length, 0);
            const archivedDateStr = new Date(m.archivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const isConfirming = confirmingDeleteId === m.archivedAt;

            return (
              <div key={m.archivedAt} className="border border-zinc-800">
                <button onClick={() => toggleOpen(m.archivedAt)}
                  className="w-full flex items-center justify-between p-4 text-left">
                  <div className="min-w-0">
                    <div className="font-bold truncate">{m.name}</div>
                    <div className="mono text-[10px] tracking-widest text-zinc-500 mt-1">
                      ARCHIVED {archivedDateStr.toUpperCase()} · {completedSessions}/{totalSessions} SESSIONS · {totalSetsLogged} SETS
                    </div>
                  </div>
                  <ChevronRight className={`w-4 h-4 text-zinc-600 flex-shrink-0 ml-2 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                </button>

                {isOpen && (
                  <div className="border-t border-zinc-900 px-4 py-4">
                    <div className="space-y-2 mb-4">
                      {m.weeks.map((wk, wIdx) => (
                        <WeekCard key={wIdx} week={wk} weekIdx={wIdx}
                          isCurrent={false}
                          isPast={true}
                          expanded={expandedWeek === wIdx}
                          onToggle={() => setExpandedWeek(expandedWeek === wIdx ? null : wIdx)}
                          onStartWorkout={() => {}}
                          units={units}
                        />
                      ))}
                    </div>
                    <button onClick={() => setConfirmingDeleteId(m.archivedAt)}
                      className="w-full bg-zinc-900 border border-zinc-800 py-3 text-red-400 mono text-xs tracking-widest font-bold hover:bg-red-950 flex items-center justify-center gap-2">
                      <Trash2 className="w-3.5 h-3.5" /> DELETE FROM ARCHIVE
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {confirmingDeleteId && (
        <ConfirmModal
          title="DELETE ARCHIVED MESO"
          message="This permanently removes this mesocycle from your history. This cannot be undone."
          confirmLabel="DELETE"
          danger
          onConfirm={() => {
            onDeleteEntry(confirmingDeleteId);
            setOpenId(prev => (prev === confirmingDeleteId ? null : prev));
            setConfirmingDeleteId(null);
          }}
          onCancel={() => setConfirmingDeleteId(null)}
        />
      )}
    </div>
  );
}

function RIRInfoBox({ onClose }) {
  return (
    <div className="bg-zinc-950 border border-zinc-800 p-4 mb-4 relative">
      <button onClick={onClose} className="absolute top-3 right-3 text-zinc-500"><X className="w-4 h-4" /></button>
      <div className="mono text-xs tracking-widest text-amber-400 mb-2">RIR — REPS IN RESERVE</div>
      <p className="text-sm text-zinc-300 leading-relaxed">
        How many more reps you could have done before failure.
        <br /><span className="text-zinc-500">3 RIR = 3 reps left in the tank. 0 RIR = absolute failure.</span>
      </p>
      <p className="text-xs text-zinc-500 mt-3 leading-relaxed">
        Calibration is the #1 failure point. Most lifters underestimate RIR by 1–2.
        If a set felt smooth at the "0 RIR" mark, you probably had more in you.
      </p>
    </div>
  );
}

// ============================================================================
// WORKOUT LOGGER
// ============================================================================
function WorkoutLogger({ day, previousWeekDay, sessionKey, weekNum, totalWeeks, isDeload, units, customExercises, setCustomExercises, exerciseVideos, setExerciseVideos, exerciseNotes, setExerciseNotes, onDeleteCustomExercise, onSwapPermanent, onDeletePermanent, onAddPermanent, onReorderPermanent, growthTargets, onSetGrowthTarget, onClearGrowthTarget, onComplete, onCancel }) {
  const draftKey = `hyperlog:draft:${sessionKey}`;

  // Exercises removed via a TODAY-ONLY delete this session. Held here (sets
  // zeroed) rather than actually discarded, because next week's generator
  // derives its roster from THIS week's completed exercise list — if a
  // today-only delete just vanished the entry, the exercise would silently
  // disappear from every future week too, which is exactly what TODAY ONLY
  // is supposed to avoid. Merged back into the array at completion time
  // (see proceedToFeedback / FeedbackForm onSubmit below) so the program
  // stays intact while today's tab list and FINISH validation never see it
  // again this session.
  const skippedTodayRef = useRef([]);

  // Silent crash/refresh recovery: prefer a saved draft over the fresh
  // prescription if one exists AND its exercise ids exactly match today's
  // (order-independent — a REST OF MESO reorder alone shouldn't invalidate an
  // otherwise-good draft, but a swap/add/delete since the draft was written
  // WOULD change that set, and a stale draft shouldn't be replayed over a
  // now-different exercise list).
  const [exercises, setExercises] = useState(() => {
    const fresh = JSON.parse(JSON.stringify(day.exercises || []));
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw);
        const draftIds = (draft.exercises || []).map(e => e.id).sort().join('|');
        const freshIds = fresh.map(e => e.id).sort().join('|');
        if (draftIds && draftIds === freshIds) {
          skippedTodayRef.current = draft.skippedToday || [];
          return draft.exercises;
        }
      }
    } catch (e) { /* corrupted or unavailable — fall back to fresh */ }
    return fresh;
  });
  const [feedback, setFeedback] = useState({});
  const [activeExIdx, setActiveExIdx] = useState(0);
  const [showFeedback, setShowFeedback] = useState(false);
  const [exerciseModalState, setExerciseModalState] = useState(null);
  const [swapping, setSwapping] = useState(false);
  const [pendingSwapEx, setPendingSwapEx] = useState(null);
  const [confirmingDeleteExercise, setConfirmingDeleteExercise] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pendingAddMuscle, setPendingAddMuscle] = useState(null);
  const [pendingAddEx, setPendingAddEx] = useState(null);
  const [confirmingMove, setConfirmingMove] = useState(false);
  // { muscle, newExId, newExName, oldExName } while confirming a star move
  // from one exercise to another for the same muscle; null otherwise.
  const [pendingStarReassign, setPendingStarReassign] = useState(null);
  // Tracks a burst of MOVE taps: null when no reorder is in progress, otherwise
  // permutation[newPos] = originalPos for everything moved since the exercise
  // last settled. moveInProgressRef distinguishes an activeExIdx change caused
  // by moveExerciseTab itself from any other navigation (tab click, prev/next).
  const movePermutationRef = useRef(null);
  const moveSettleTimerRef = useRef(null);
  const moveInProgressRef = useRef(false);
  const MOVE_SETTLE_MS = 3000;

  // Silent "discreet save" — mirrors in-progress logging to localStorage so a
  // refresh, tab kill, or an intentional Exit never costs more than a beat of
  // typing. Debounced after every set/exercise edit (below), and flushed
  // immediately on exercise-tab navigation (in the effect right after this
  // one) — that's exactly the moment worth guaranteeing fresh rather than
  // eventually-consistent. Deliberately NEVER deleted here, including after a
  // successful FINISH — completion only updates local `meso` state, and the
  // actual durable write to Supabase happens later, async, on an 800ms
  // debounce in AppInner. Deleting the draft the instant FINISH is tapped
  // (as an earlier version of this did) leaves a real gap: if the tab gets
  // reloaded before that Supabase write lands — e.g. a backgrounded mobile
  // tab getting silently evicted, worse on bad wifi — the safety net is
  // already gone AND the sync never happened, losing the whole session with
  // no recovery path. Leaving the draft in place costs nothing: once a day
  // is genuinely completed and synced, Dashboard never routes back into
  // WorkoutLogger for it, so the stale draft is simply never read again.
  const saveDraft = (exercisesToSave) => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ exercises: exercisesToSave, skippedToday: skippedTodayRef.current, savedAt: Date.now() }));
    } catch (e) { /* storage full/unavailable — best-effort only */ }
  };

  useEffect(() => {
    const handle = setTimeout(() => saveDraft(exercises), 500);
    return () => clearTimeout(handle);
  }, [exercises, draftKey]);

  // Reset swap/add state when navigating between exercises (tabs, prev/next).
  // A move-triggered change is handled separately below — it must NOT clear the
  // burst it just started, or the settle timer could never fire.
  useEffect(() => {
    saveDraft(exercises); // flush immediately on nav, not just on the debounce
    setSwapping(false);
    setPendingSwapEx(null);
    setAdding(false);
    setPendingAddMuscle(null);
    setPendingAddEx(null);
    if (!moveInProgressRef.current) {
      // Navigated away for some other reason before the exercise sat still for
      // MOVE_SETTLE_MS — treat the pending reorder as today-only rather than
      // pop a confirmation about an exercise the user isn't looking at anymore.
      if (moveSettleTimerRef.current) {
        clearTimeout(moveSettleTimerRef.current);
        moveSettleTimerRef.current = null;
      }
      movePermutationRef.current = null;
    }
    moveInProgressRef.current = false;
  }, [activeExIdx]);

  // Clear any pending settle timer if the component unmounts mid-countdown
  // (e.g. Exit tapped right after a move) — avoids a setState-after-unmount.
  useEffect(() => {
    return () => {
      if (moveSettleTimerRef.current) clearTimeout(moveSettleTimerRef.current);
    };
  }, []);

  // Resolve current video URL — user-edited override beats snapshot
  const getEffectiveVideoUrl = (ex) => {
    if (ex.id in (exerciseVideos || {})) return exerciseVideos[ex.id] || null;
    return ex.videoUrl || null;
  };

  // Resolve a display name for an exercise id that may not be in today's
  // session (the currently-starred exercise for a muscle could live on a
  // different day) — checks today's own list first, then the library, then
  // custom exercises for that muscle.
  const findExerciseName = (muscle, exId) => {
    const fromToday = exercises.find(e => e.id === exId);
    if (fromToday) return fromToday.name;
    const fromLibrary = (EXERCISES[muscle] || []).find(e => e.id === exId);
    if (fromLibrary) return fromLibrary.name;
    const fromCustom = (customExercises[muscle] || []).find(e => e.id === exId);
    if (fromCustom) return fromCustom.name;
    return 'the current exercise';
  };

  // Last week's logged numbers for this exact exercise+set slot, for the
  // faded placeholder hint — id-matched (so a swapped exercise correctly
  // shows nothing) and position-matched by set index. Returns null for week
  // 1, a newly-added exercise, or a set index that didn't exist last week
  // (e.g. this week added a set via progression).
  const getLastWeekSet = (exerciseId, setIdx) => {
    if (!previousWeekDay?.exercises) return null;
    const prevEx = previousWeekDay.exercises.find(e => e.id === exerciseId);
    return prevEx?.sets?.[setIdx] || null;
  };

  // Handler for video edit save
  const handleVideoEditSave = (exerciseId, newUrl) => {
    const next = { ...(exerciseVideos || {}) };
    if (newUrl) next[exerciseId] = newUrl;
    else next[exerciseId] = null;
    setExerciseVideos(next);
    setExerciseModalState(null);
  };

  // Handler for note save — empty string removes the note entirely
  const handleNoteSave = (exerciseId, newNote) => {
    const next = { ...(exerciseNotes || {}) };
    if (newNote) next[exerciseId] = newNote;
    else delete next[exerciseId];
    setExerciseNotes(next);
    setExerciseModalState(null);
  };

  // Handler for deleting custom exercise during workout (snapshots preserved)
  const handleDeleteCustomFromWorkout = (exerciseId, muscle) => {
    onDeleteCustomExercise(exerciseId, muscle);
    setExerciseModalState(null);
  };
  const [confirmingIncomplete, setConfirmingIncomplete] = useState(false);

  const updateSet = (exIdx, setIdx, field, value) => {
    const next = [...exercises];
    next[exIdx].sets[setIdx][field] = value;
    setExercises(next);
  };

  const addSet = (exIdx) => {
    const next = [...exercises];
    const last = next[exIdx].sets[next[exIdx].sets.length - 1];
    next[exIdx].sets.push({ weight: last?.weight ?? 0, reps: null, rirTarget: last?.rirTarget ?? 2, rirActual: null, technique: null });
    setExercises(next);
  };

  const removeSet = (exIdx, setIdx) => {
    const next = [...exercises];
    if (next[exIdx].sets.length > 1) {
      next[exIdx].sets.splice(setIdx, 1);
      setExercises(next);
    }
  };

  // Build available exercises for a given muscle (library + customs, all muscles)
  const getSwapOptions = (muscle) => {
    const library = (EXERCISES[muscle] || []).map(ex => ({ ...ex }));
    const custom = (customExercises[muscle] || []).map(ex => ({ ...ex }));
    return [...library, ...custom];
  };

  const applySwap = (exIdx, newEx, scope) => {
    // Always update the current session
    const next = [...exercises];
    next[exIdx] = {
      ...next[exIdx],
      id: newEx.id,
      name: newEx.name,
      equipment: newEx.equipment,
      isCustom: newEx.isCustom || false,
      assisted: newEx.assisted || false,
      videoUrl: newEx.videoUrl || null,
      weightNote: null,
    };
    setExercises(next);
    // If permanent, also update future meso days
    if (scope === 'meso') {
      onSwapPermanent(exercises[exIdx].id, newEx);
    }
    setSwapping(false);
    setPendingSwapEx(null);
  };

  // Delete an exercise. REST OF MESO mirrors swap/add's meso scope — removes
  // it from today and every remaining instance via onDeletePermanent. TODAY
  // ONLY takes it out of today's tabs and FINISH validation, but stashes it
  // (sets zeroed) in skippedTodayRef rather than discarding it outright, so
  // completion still hands next week's generator a roster that includes it —
  // otherwise the exercise would vanish from the whole rest of the meso, not
  // just today, since next week is built from this week's completed list.
  const applyDelete = (exIdx, scope) => {
    const exToDelete = exercises[exIdx];
    const next = exercises.filter((_, i) => i !== exIdx);
    if (scope === 'today') {
      skippedTodayRef.current = [...skippedTodayRef.current, { ...exToDelete, sets: [] }];
    } else {
      onDeletePermanent(exToDelete.id);
    }
    if (next.length === 0) {
      onCancel();
      return;
    }
    setExercises(next);
    setActiveExIdx(Math.min(exIdx, next.length - 1));
    setSwapping(false);
    setPendingSwapEx(null);
  };

  // Reorder exercises mid-session. Applies immediately (no waiting to see the
  // move happen), but doesn't ask TODAY ONLY / REST OF MESO right away — that
  // would mean a prompt after every single tap when moving something several
  // slots. Instead each tap (re)starts a settle timer; once MOVE_SETTLE_MS
  // passes with no further taps, the confirmation appears for wherever things
  // ended up. movePermutationRef tracks the position-swap in parallel with the
  // actual array so it can be replayed onto other weeks (REST OF MESO) or
  // undone entirely (CANCEL) regardless of how many taps made up the burst.
  const moveExerciseTab = (direction) => {
    const toIdx = activeExIdx + direction;
    if (toIdx < 0 || toIdx >= exercises.length) return;

    if (!movePermutationRef.current) {
      movePermutationRef.current = exercises.map((_, i) => i); // start a new burst
    }
    const perm = [...movePermutationRef.current];
    [perm[activeExIdx], perm[toIdx]] = [perm[toIdx], perm[activeExIdx]];
    movePermutationRef.current = perm;

    const next = [...exercises];
    [next[activeExIdx], next[toIdx]] = [next[toIdx], next[activeExIdx]];
    setExercises(next);
    moveInProgressRef.current = true;
    setActiveExIdx(toIdx);

    if (moveSettleTimerRef.current) clearTimeout(moveSettleTimerRef.current);
    moveSettleTimerRef.current = setTimeout(() => {
      moveSettleTimerRef.current = null;
      const perm = movePermutationRef.current;
      const netChanged = perm && perm.some((origIdx, i) => origIdx !== i);
      if (netChanged) {
        setConfirmingMove(true);
      } else {
        // Back where it started — nothing to confirm, don't interrupt.
        movePermutationRef.current = null;
      }
    }, MOVE_SETTLE_MS);
  };

  // CANCEL on the settle prompt — undo the whole burst, not just the last tap.
  // Inverts movePermutationRef against the current array to rebuild the order
  // as it stood before the first move in this burst, and re-points activeExIdx
  // at the same exercise it was showing (now back in its original slot).
  const revertMove = () => {
    const perm = movePermutationRef.current;
    if (!perm) return;
    const original = new Array(exercises.length);
    perm.forEach((origIdx, curIdx) => { original[origIdx] = exercises[curIdx]; });
    setExercises(original);
    setActiveExIdx(perm[activeExIdx]);
  };

  // Add a brand-new exercise mid-session. Same TODAY ONLY / REST OF MESO fork
  // as swap: session-only just appends locally; meso scope also appends to this
  // same day-slot (this weekIdx's day included, plus every future week's same
  // slot) via onAddPermanent, mirroring handleSwapPermanent/handleDeletePermanent's
  // traversal — this time pushing a freshly-built exercise instead of altering one.
  const applyAdd = (newEx, muscle, scope) => {
    const startSets = getStartingSets(muscle, undefined);
    const targetRIR = exercises[0]?.sets?.[0]?.rirTarget ?? 2; // match today's RIR target
    const newEntry = {
      id: newEx.id,
      name: newEx.name,
      muscle,
      assisted: newEx.assisted || false,
      videoUrl: newEx.videoUrl || null,
      sets: Array(startSets).fill(null).map(() => ({
        weight: 0, reps: null, rirTarget: targetRIR, rirActual: null, technique: null,
      })),
    };
    const next = [...exercises, newEntry];
    setExercises(next);
    setActiveExIdx(next.length - 1);
    if (scope === 'meso') {
      onAddPermanent(muscle, newEx);
    }
    setAdding(false);
    setPendingAddMuscle(null);
    setPendingAddEx(null);
  };

  // Handle custom exercise creation from either the swap picker or the add panel —
  // exerciseModalState.forAddPanel tells us which pending slot to fill on save.
  const handleAddCustomExercise = (newExercise, videoUrl) => {
    if (!exerciseModalState) return;
    const { muscle, forAddPanel } = exerciseModalState;
    if (!muscle) return;
    const customDef = { id: newExercise.id, name: newExercise.name, equipment: 'custom', isCustom: true, assisted: newExercise.assisted || false };
    setCustomExercises({
      ...customExercises,
      [muscle]: [...(customExercises[muscle] || []), customDef],
    });
    if (videoUrl) {
      setExerciseVideos({ ...(exerciseVideos || {}), [newExercise.id]: videoUrl });
    }
    if (forAddPanel) {
      setPendingAddEx({ ...customDef, videoUrl: videoUrl || null });
    } else {
      setPendingSwapEx({ ...customDef, videoUrl: videoUrl || null });
    }
    setExerciseModalState(null);
  };

  const allSetsLogged = exercises.every(ex => ex.sets.every(s => s.reps !== null && s.rirActual !== null));
  // iOS Safari's native <select> can fire its change/blur event after an adjacent
  // button's click event, so a value picked immediately before tapping FINISH may not
  // have committed to state yet. This ref lets handleComplete read the freshest value
  // after forcing that pending commit (see handleComplete below).
  const allSetsLoggedRef = useRef(allSetsLogged);
  allSetsLoggedRef.current = allSetsLogged;
  const uniqueMuscles = [...new Set(exercises.map(e => e.muscle))];

  // Build disambiguated tab labels (CHEST 1, CHEST 2 when same muscle appears twice)
  const tabLabels = (() => {
    const totals = {};
    exercises.forEach(e => { totals[e.muscle] = (totals[e.muscle] || 0) + 1; });
    const seen = {};
    return exercises.map(e => {
      seen[e.muscle] = (seen[e.muscle] || 0) + 1;
      return totals[e.muscle] > 1
        ? `${e.muscle.toUpperCase()} ${seen[e.muscle]}`
        : e.muscle.toUpperCase();
    });
  })();

  const proceedToFeedback = () => {
    if (Object.keys(feedback).length === 0) {
      setShowFeedback(true);
      return;
    }
    onComplete({ exercises: [...exercises, ...skippedTodayRef.current], feedback });
  };

  const handleComplete = () => {
    // If a set's RIR <select> is still focused (native picker just dismissed),
    // force it to commit before we check. On iOS Safari this blur/change can
    // otherwise land after this click, making a just-filled field read as unlogged.
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
    requestAnimationFrame(() => {
      if (!allSetsLoggedRef.current) {
        setConfirmingIncomplete(true);
        return;
      }
      proceedToFeedback();
    });
  };

  if (showFeedback) {
    return <FeedbackForm muscles={uniqueMuscles} feedback={feedback} setFeedback={setFeedback}
      onBack={() => setShowFeedback(false)}
      onSubmit={() => onComplete({ exercises: [...exercises, ...skippedTodayRef.current], feedback })} />;
  }

  const ex = exercises[activeExIdx];
  const loggedSetsForActiveEx = ex.sets.filter(s => s.reps !== null).length;

  return (
    <div className="min-h-screen bg-black text-zinc-100 pb-24">
      <style>{FONT_STYLE}</style>
      <div className="border-b border-zinc-800 px-5 py-4 sticky top-0 bg-black z-10">
        <div className="flex items-center justify-between">
          <button onClick={onCancel} className="text-zinc-400 text-sm flex items-center gap-1">
            <X className="w-4 h-4" /> Exit
          </button>
          <div className="mono text-xs text-zinc-500">
            W{weekNum} · {day.name} {isDeload && <span className="text-sky-400 ml-1">DELOAD</span>}
          </div>
        </div>
      </div>

      {/* Exercise tabs — the active tab grows arrows around its own label for
          mid-session reorder; inactive tabs stay plain. ADD EXERCISE rides at
          the end of the same scrollable row. No separate control row at all. */}
      <div className="border-b border-zinc-900 overflow-x-auto">
        <div className="flex items-stretch">
          {exercises.map((e, idx) => {
            const isActive = activeExIdx === idx;
            if (!isActive) {
              return (
                <button key={idx} onClick={() => setActiveExIdx(idx)}
                  className="px-4 py-3 mono text-xs whitespace-nowrap border-b-2 border-transparent text-zinc-500 flex-shrink-0">
                  {tabLabels[idx]}
                </button>
              );
            }
            return (
              <div key={idx} className="flex items-center border-b-2 border-amber-400 flex-shrink-0">
                <button onClick={() => moveExerciseTab(-1)} disabled={idx === 0}
                  title="Move this exercise earlier"
                  className="pl-3 pr-1.5 py-3 text-amber-400 disabled:opacity-20 disabled:cursor-not-allowed hover:text-amber-300">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="mono text-xs whitespace-nowrap text-white font-bold">
                  {tabLabels[idx]}
                </span>
                <button onClick={() => moveExerciseTab(1)} disabled={idx === exercises.length - 1}
                  title="Move this exercise later"
                  className="pl-1.5 pr-3 py-3 text-amber-400 disabled:opacity-20 disabled:cursor-not-allowed hover:text-amber-300">
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
          <button
            onClick={() => { setAdding(a => !a); setSwapping(false); setPendingSwapEx(null); }}
            className={`ml-3 px-4 py-3 mono text-xs font-bold whitespace-nowrap flex items-center gap-1.5 flex-shrink-0 ${adding ? 'bg-amber-300 text-black' : 'bg-amber-400 text-black hover:bg-amber-300'}`}>
            <Plus className="w-3.5 h-3.5" /> ADD EXERCISE
          </button>
        </div>
      </div>

      {adding && (
        <div className="px-5 pt-4">
          <div className="border border-zinc-800 p-3 bg-zinc-950">
            <label className="mono text-[10px] tracking-widest text-zinc-500 block mb-2">MUSCLE</label>
            <select
              value={pendingAddMuscle || ''}
              onChange={e => { setPendingAddMuscle(e.target.value); setPendingAddEx(null); }}
              className="w-full bg-zinc-900 border border-zinc-700 px-3 py-2 mono text-sm text-white outline-none focus:border-amber-400 mb-3">
              <option value="" disabled>SELECT MUSCLE…</option>
              {MUSCLE_GROUPS.map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
            </select>

            {pendingAddMuscle && (
              <>
                <label className="mono text-[10px] tracking-widest text-zinc-500 block mb-2">EXERCISE</label>
                <select
                  value={pendingAddEx?.id || ''}
                  onChange={e => {
                    const opts = getSwapOptions(pendingAddMuscle);
                    const found = opts.find(o => o.id === e.target.value);
                    setPendingAddEx(found || null);
                  }}
                  className="w-full bg-zinc-900 border border-zinc-700 px-3 py-2 mono text-sm text-white outline-none focus:border-amber-400 mb-2">
                  <option value="" disabled>SELECT EXERCISE…</option>
                  {getSwapOptions(pendingAddMuscle).map(opt => (
                    <option key={opt.id} value={opt.id}>{opt.name}{opt.assisted ? ' · ASSISTED' : ''}{opt.isCustom ? ' ✦' : ''}</option>
                  ))}
                </select>
                <button
                  onClick={() => setExerciseModalState({ mode: 'add_custom', muscle: pendingAddMuscle, forAddPanel: true })}
                  className="w-full border border-dashed border-zinc-700 py-2 text-zinc-500 mono text-[10px] tracking-widest flex items-center justify-center gap-2 hover:border-amber-400 hover:text-amber-400 mb-3">
                  <Plus className="w-3 h-3" /> ADD CUSTOM EXERCISE
                </button>
              </>
            )}

            {pendingAddEx ? (
              <>
                <div className="mono text-[10px] text-zinc-500 tracking-widest mb-2">APPLY TO:</div>
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={() => applyAdd(pendingAddEx, pendingAddMuscle, 'session')}
                    className="py-2 bg-amber-400 text-black mono text-[10px] font-bold tracking-wider">
                    TODAY ONLY
                  </button>
                  <button onClick={() => applyAdd(pendingAddEx, pendingAddMuscle, 'meso')}
                    className="py-2 border border-amber-400 text-amber-400 mono text-[10px] font-bold tracking-wider hover:bg-amber-400 hover:text-black">
                    REST OF MESO
                  </button>
                  <button onClick={() => { setAdding(false); setPendingAddMuscle(null); setPendingAddEx(null); }}
                    className="py-2 border border-zinc-700 text-zinc-400 mono text-[10px] font-bold tracking-wider hover:border-zinc-500">
                    CANCEL
                  </button>
                </div>
              </>
            ) : (
              <button onClick={() => { setAdding(false); setPendingAddMuscle(null); setPendingAddEx(null); }}
                className="w-full py-2 border border-zinc-800 text-zinc-600 mono text-[10px] tracking-widest hover:border-zinc-600">
                CANCEL
              </button>
            )}
          </div>
        </div>
      )}

      <div className="px-5 py-5">
        <div className="flex items-center justify-between mb-1 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-2xl font-black tracking-tight truncate">{ex.name}</h2>
            <button
              onClick={() => { setSwapping(s => !s); setPendingSwapEx(null); setAdding(false); setPendingAddMuscle(null); setPendingAddEx(null); }}
              title="Swap exercise"
              className={`w-8 h-8 border flex items-center justify-center flex-shrink-0 ${swapping ? 'bg-amber-400 border-amber-400 text-black' : 'border-zinc-700 text-zinc-400 hover:border-amber-400 hover:text-amber-400'}`}>
              <Edit3 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                const currentStarredId = growthTargets?.[ex.muscle];
                if (currentStarredId === ex.id) {
                  onClearGrowthTarget(ex.muscle);
                } else if (currentStarredId) {
                  setPendingStarReassign({
                    muscle: ex.muscle,
                    newExId: ex.id,
                    newExName: ex.name,
                    oldExName: findExerciseName(ex.muscle, currentStarredId),
                  });
                } else {
                  onSetGrowthTarget(ex.muscle, ex.id);
                }
              }}
              title={growthTargets?.[ex.muscle] === ex.id ? 'Remove growth emphasis' : `Make this ${ex.muscle}'s growth exercise`}
              className={`w-8 h-8 border flex items-center justify-center flex-shrink-0 ${growthTargets?.[ex.muscle] === ex.id ? 'bg-amber-400 border-amber-400 text-black' : 'border-zinc-700 text-zinc-400 hover:border-amber-400 hover:text-amber-400'}`}>
              <Star className="w-3.5 h-3.5" fill={growthTargets?.[ex.muscle] === ex.id ? 'currentColor' : 'none'} />
            </button>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {getEffectiveVideoUrl(ex) && (
              <a href={getEffectiveVideoUrl(ex)} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-amber-400 mono text-[10px] tracking-widest border border-amber-400/40 px-2 py-1 hover:bg-amber-400 hover:text-black">
                <Play className="w-3 h-3" fill="currentColor" /> WATCH
              </a>
            )}
            <button
              onClick={() => setExerciseModalState({
                mode: 'edit_note',
                exerciseId: ex.id,
                exerciseName: ex.name,
                muscle: ex.muscle,
              })}
              title={exerciseNotes?.[ex.id] ? 'Edit notes' : 'Add notes'}
              className={`w-8 h-8 border flex items-center justify-center ${exerciseNotes?.[ex.id] ? 'bg-zinc-700 border-zinc-600 text-amber-400' : 'border-zinc-700 text-zinc-400 hover:border-amber-400 hover:text-amber-400'}`}>
              <StickyNote className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setExerciseModalState({
                mode: 'edit_video',
                exerciseId: ex.id,
                exerciseName: ex.name,
                muscle: ex.muscle,
                isCustom: ex.id.startsWith('custom-'),
              })}
              className="bg-amber-400 border border-amber-400 w-8 h-8 flex items-center justify-center hover:bg-amber-300"
              title={getEffectiveVideoUrl(ex) ? 'Edit / remove video link' : 'Add video link'}>
              <Play className="w-3.5 h-3.5 text-red-600" fill={getEffectiveVideoUrl(ex) ? 'none' : 'currentColor'} />
            </button>
          </div>
        </div>

        {/* Swap exercise panel */}
        {swapping && (
          <div className="mb-4 border border-zinc-800 p-3 bg-zinc-950">
            <label className="mono text-[10px] tracking-widest text-zinc-500 block mb-2">SELECT REPLACEMENT</label>
            <select
              value={pendingSwapEx?.id || ex.id}
              onChange={e => {
                const opts = getSwapOptions(ex.muscle);
                const found = opts.find(o => o.id === e.target.value);
                setPendingSwapEx(found || null);
              }}
              className="w-full bg-zinc-900 border border-zinc-700 px-3 py-2 mono text-sm text-white outline-none focus:border-amber-400 mb-2">
              {getSwapOptions(ex.muscle).map(opt => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}{opt.assisted ? ' · ASSISTED' : ''}{opt.isCustom ? ' ✦' : ''}
                </option>
              ))}
            </select>
            <button
              onClick={() => setExerciseModalState({ mode: 'add_custom', muscle: ex.muscle })}
              className="w-full border border-dashed border-zinc-700 py-2 text-zinc-500 mono text-[10px] tracking-widest flex items-center justify-center gap-2 hover:border-amber-400 hover:text-amber-400 mb-3">
              <Plus className="w-3 h-3" /> ADD CUSTOM EXERCISE
            </button>
            {pendingSwapEx && pendingSwapEx.id !== ex.id && (
              <>
                <div className="mono text-[10px] text-zinc-500 tracking-widest mb-2">APPLY TO:</div>
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={() => applySwap(activeExIdx, pendingSwapEx, 'session')}
                    className="py-2 bg-amber-400 text-black mono text-[10px] font-bold tracking-wider">
                    TODAY ONLY
                  </button>
                  <button onClick={() => applySwap(activeExIdx, pendingSwapEx, 'meso')}
                    className="py-2 border border-amber-400 text-amber-400 mono text-[10px] font-bold tracking-wider hover:bg-amber-400 hover:text-black">
                    REST OF MESO
                  </button>
                  <button onClick={() => { setSwapping(false); setPendingSwapEx(null); }}
                    className="py-2 border border-zinc-700 text-zinc-400 mono text-[10px] font-bold tracking-wider hover:border-zinc-500">
                    CANCEL
                  </button>
                </div>
              </>
            )}
            {(!pendingSwapEx || pendingSwapEx.id === ex.id) && (
              <>
                <button
                  onClick={() => setConfirmingDeleteExercise(true)}
                  className="w-full py-2 border border-red-900 bg-zinc-900 text-red-400 mono text-[10px] tracking-widest font-bold flex items-center justify-center gap-2 hover:bg-red-950 mb-3">
                  <Trash2 className="w-3 h-3" /> DELETE EXERCISE
                </button>
                <button onClick={() => { setSwapping(false); setPendingSwapEx(null); }}
                  className="w-full py-2 border border-zinc-800 text-zinc-600 mono text-[10px] tracking-widest hover:border-zinc-600">
                  CANCEL
                </button>
              </>
            )}
          </div>
        )}
        {ex.weightNote && (
          <div className="mono text-[11px] text-amber-400/70 mb-4">→ {ex.weightNote}</div>
        )}
        {exerciseNotes?.[ex.id] && (
          <div className="bg-zinc-950 border-l-2 border-zinc-600 px-3 py-2 mb-4 mono text-[11px] text-zinc-300 whitespace-pre-line">
            {exerciseNotes[ex.id]}
          </div>
        )}

        {/* Sets table header — mt-2 + top border give it a fixed visual start
            regardless of whether weightNote/notes appear above, so it never
            reads as a continuation of the title block. */}
        <div className="grid grid-cols-12 gap-2 mt-2 mb-3 pt-3 border-t border-zinc-900 mono text-[10px] tracking-widest text-zinc-600">
          <div className="col-span-1">#</div>
          <div className="col-span-1"></div>
          <div className="col-span-3">{ex.assisted ? 'ASSISTANCE' : 'WEIGHT'}</div>
          <div className="col-span-2">REPS</div>
          <div className="col-span-1 text-center">TGT RIR</div>
          <div className="col-span-3 text-center pr-6">RIR</div>
          <div className="col-span-1"></div>
        </div>

        {ex.sets.map((set, sIdx) => {
          const lastWeekSet = getLastWeekSet(ex.id, sIdx);
          return (
            <SetRow key={sIdx} num={sIdx + 1} set={set} units={units}
              canRemove={ex.sets.length > 1}
              lastWeekReps={lastWeekSet?.reps ?? null}
              lastWeekWeight={set.weight ? null : (lastWeekSet?.weight || null)}
              onChange={(field, value) => updateSet(activeExIdx, sIdx, field, value)}
              onRemove={() => removeSet(activeExIdx, sIdx)}
            />
          );
        })}

        <button onClick={() => addSet(activeExIdx)}
          className="w-full mt-3 border border-dashed border-zinc-800 py-3 text-zinc-500 text-xs mono tracking-widest flex items-center justify-center gap-2">
          <Plus className="w-3 h-3" /> ADD SET
        </button>

        {/* Nav between exercises */}
        <div className="grid grid-cols-2 gap-2 mt-6">
          <button onClick={() => setActiveExIdx(Math.max(0, activeExIdx - 1))}
            disabled={activeExIdx === 0}
            className="bg-zinc-900 border border-zinc-800 py-3 disabled:opacity-30 mono text-xs tracking-widest">
            ← PREV
          </button>
          {activeExIdx < exercises.length - 1 ? (
            <button onClick={() => setActiveExIdx(activeExIdx + 1)}
              className="bg-zinc-900 border border-zinc-800 py-3 mono text-xs tracking-widest">
              NEXT →
            </button>
          ) : (
            <button onClick={handleComplete}
              className="bg-amber-400 text-black py-3 font-bold mono text-xs tracking-widest">
              FINISH →
            </button>
          )}
        </div>
      </div>

      {confirmingIncomplete && (
        <ConfirmModal
          title="UNLOGGED SETS"
          message="Some sets don't have reps or RIR logged. Submit anyway? Unlogged sets will be excluded from the autoregulation calculation for next week."
          confirmLabel="SUBMIT"
          onConfirm={() => { setConfirmingIncomplete(false); proceedToFeedback(); }}
          onCancel={() => setConfirmingIncomplete(false)}
        />
      )}
      {confirmingDeleteExercise && (
        <ScopeConfirmModal
          danger
          title="DELETE EXERCISE"
          message={`Remove ${ex.name} just for today, or from the rest of this meso too?${loggedSetsForActiveEx > 0 ? ` Discards ${loggedSetsForActiveEx} logged set${loggedSetsForActiveEx === 1 ? '' : 's'} from today either way.` : ''}`}
          onTodayOnly={() => { setConfirmingDeleteExercise(false); applyDelete(activeExIdx, 'today'); }}
          onRestOfMeso={() => { setConfirmingDeleteExercise(false); applyDelete(activeExIdx, 'meso'); }}
          onCancel={() => setConfirmingDeleteExercise(false)}
        />
      )}
      {confirmingMove && (
        <ScopeConfirmModal
          title="REORDER EXERCISE"
          message="Keep this new order for the rest of the meso, or just for today?"
          onTodayOnly={() => { movePermutationRef.current = null; setConfirmingMove(false); }}
          onRestOfMeso={() => {
            onReorderPermanent(movePermutationRef.current);
            movePermutationRef.current = null;
            setConfirmingMove(false);
          }}
          onCancel={() => { revertMove(); movePermutationRef.current = null; setConfirmingMove(false); }}
        />
      )}
      {pendingStarReassign && (
        <ConfirmModal
          title="CHANGE GROWTH EXERCISE"
          message={`This moves ${pendingStarReassign.muscle.toUpperCase()}'s growth emphasis from ${pendingStarReassign.oldExName} to ${pendingStarReassign.newExName}. Earned sets for this muscle will go to ${pendingStarReassign.newExName} going forward.`}
          confirmLabel="CONFIRM"
          onConfirm={() => {
            onSetGrowthTarget(pendingStarReassign.muscle, pendingStarReassign.newExId);
            setPendingStarReassign(null);
          }}
          onCancel={() => setPendingStarReassign(null)}
        />
      )}
      {exerciseModalState && (
        <ExerciseModal
          state={exerciseModalState}
          initialVideoUrl={
            exerciseModalState.mode === 'edit_video'
              ? (exerciseVideos && exerciseModalState.exerciseId in exerciseVideos
                  ? (exerciseVideos[exerciseModalState.exerciseId] || '')
                  : (exercises.find(e => e.id === exerciseModalState.exerciseId)?.videoUrl || ''))
              : ''
          }
          initialNote={
            exerciseModalState.mode === 'edit_note'
              ? (exerciseNotes?.[exerciseModalState.exerciseId] || '')
              : ''
          }
          onSaveCustom={handleAddCustomExercise}
          onSaveVideo={handleVideoEditSave}
          onSaveNote={handleNoteSave}
          onDeleteExercise={handleDeleteCustomFromWorkout}
          onCancel={() => setExerciseModalState(null)}
        />
      )}
    </div>
  );
}

// Small icon button that opens TechniqueModal to tag a set with an intensity
// technique (drop set, myo-rep, etc). Untagged = quiet ⋮ icon; tagged = filled
// colored badge showing the 2-letter abbreviation, still tappable to change/clear.
function TechniqueTag({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const active = value ? TECHNIQUES[value] : null;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        aria-label={active ? `Technique: ${active.label}` : 'Tag set technique'}
        title={active ? active.label : 'Tag technique (drop set, myo-rep, rest-pause…)'}
        className={active
          ? `w-full py-1.5 mono text-[9px] font-bold tracking-wider border ${active.color}`
          : 'w-full py-1.5 flex items-center justify-center text-zinc-600 hover:text-amber-400'}>
        {active ? active.abbr : <MoreVertical className="w-4 h-4" />}
      </button>
      {open && (
        <TechniqueModal
          current={value}
          onSelect={key => { onChange(key); setOpen(false); }}
          onClear={() => { onChange(null); setOpen(false); }}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}

// Picker modal for TechniqueTag — same fixed-overlay convention as ConfirmModal
// so it behaves consistently with every other in-app modal (full-screen dim,
// tap outside to cancel, content click doesn't bubble to the overlay).
function TechniqueModal({ current, onSelect, onClear, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center p-5"
      onClick={onCancel}>
      <div className="bg-zinc-950 border border-zinc-800 p-5 max-w-sm w-full"
        onClick={e => e.stopPropagation()}>
        <div className="mono text-xs tracking-widest mb-4 text-amber-400">TAG SET TECHNIQUE</div>
        <div className="space-y-1.5 mb-4">
          {Object.entries(TECHNIQUES).map(([key, t]) => (
            <button key={key} onClick={() => onSelect(key)}
              className={`w-full flex items-center justify-between px-3 py-2.5 border mono text-xs tracking-wider font-bold ${current === key ? t.color : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-600'}`}>
              <span>{t.label.toUpperCase()}</span>
              <span className="opacity-70">{t.abbr}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onClear}
            className="bg-zinc-900 border border-zinc-800 py-3 text-zinc-400 mono text-xs tracking-widest">
            CLEAR TAG
          </button>
          <button onClick={onCancel}
            className="bg-zinc-900 border border-zinc-800 py-3 text-zinc-300 mono text-xs tracking-widest">
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}

function SetRow({ num, set, units, canRemove, lastWeekReps, lastWeekWeight, onChange, onRemove }) {
  return (
    <div className="grid grid-cols-12 gap-2 mb-2 items-center">
      <div className="col-span-1 mono text-zinc-500">{num}</div>
      <div className="col-span-1">
        <TechniqueTag value={set.technique} onChange={v => onChange('technique', v)} />
      </div>
      <div className="col-span-3">
        <input type="number" inputMode="decimal"
          value={set.weight ? set.weight : ''}
          onFocus={e => e.target.select()}
          onChange={e => {
            const v = e.target.value;
            onChange('weight', v === '' ? 0 : (parseFloat(v) || 0));
          }}
          placeholder={lastWeekWeight != null ? String(lastWeekWeight) : undefined}
          className="w-full bg-zinc-900 border border-zinc-800 px-2 py-2 mono text-sm focus:border-amber-400 outline-none placeholder:text-zinc-600" />
      </div>
      <div className="col-span-2">
        <input type="number" inputMode="numeric"
          value={set.reps ?? ''}
          onFocus={e => e.target.select()}
          onChange={e => onChange('reps', e.target.value === '' ? null : parseInt(e.target.value))}
          placeholder={lastWeekReps != null ? String(lastWeekReps) : undefined}
          className="w-full bg-zinc-900 border border-zinc-800 px-2 py-2 mono text-sm focus:border-amber-400 outline-none text-center placeholder:text-zinc-600" />
      </div>
      <div className="col-span-1 text-center mono text-sm text-zinc-500">{set.rirTarget}</div>
      <div className="col-span-3">
        <select value={set.rirActual ?? ''}
          onChange={e => onChange('rirActual', e.target.value === '' ? null : parseInt(e.target.value))}
          className="w-full bg-zinc-900 border border-zinc-800 px-1 py-2 mono text-sm focus:border-amber-400 outline-none text-center">
          <option value="">—</option>
          {[0, 1, 2, 3, 4, 5].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className="col-span-1 flex justify-end">
        <button onClick={onRemove}
          disabled={!canRemove}
          aria-label="Remove set"
          className={`p-1 ${canRemove ? 'text-zinc-400 hover:text-red-400 active:text-red-400' : 'text-zinc-800 cursor-not-allowed'}`}>
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// WORKOUT VIEWER — read-only display of a completed day's logged sets/reps.
// Reached via the "LOGGED →" button on a completed day in the Dashboard
// schedule. No mutation of any kind — just tab navigation between exercises.
// ============================================================================
function WorkoutViewer({ day, weekNum, onBack }) {
  const [activeExIdx, setActiveExIdx] = useState(0);
  const exercises = day.exercises || [];
  const ex = exercises[activeExIdx];

  // Build disambiguated tab labels (CHEST 1, CHEST 2 when same muscle appears twice)
  const tabLabels = (() => {
    const totals = {};
    exercises.forEach(e => { totals[e.muscle] = (totals[e.muscle] || 0) + 1; });
    const seen = {};
    return exercises.map(e => {
      seen[e.muscle] = (seen[e.muscle] || 0) + 1;
      return totals[e.muscle] > 1
        ? `${e.muscle.toUpperCase()} ${seen[e.muscle]}`
        : e.muscle.toUpperCase();
    });
  })();

  return (
    <div className="min-h-screen bg-black text-zinc-100 pb-24">
      <style>{FONT_STYLE}</style>
      <div className="border-b border-zinc-800 px-5 py-4 sticky top-0 bg-black z-10">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="text-zinc-400 text-sm flex items-center gap-1">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="mono text-xs text-zinc-500">
            W{weekNum} · {day.name} <span className="text-emerald-400 ml-1">LOGGED</span>
          </div>
        </div>
      </div>

      {!ex ? (
        <div className="px-5 py-12 text-center text-zinc-500 text-sm">
          No exercises logged for this day.
        </div>
      ) : (
        <>
          {/* Exercise tabs */}
          <div className="border-b border-zinc-900 overflow-x-auto">
            <div className="flex">
              {exercises.map((e, idx) => (
                <button key={idx} onClick={() => setActiveExIdx(idx)}
                  className={`px-4 py-3 mono text-xs whitespace-nowrap border-b-2 ${activeExIdx === idx ? 'border-amber-400 text-white' : 'border-transparent text-zinc-500'}`}>
                  {tabLabels[idx]}
                </button>
              ))}
            </div>
          </div>

          <div className="px-5 py-5">
            <h2 className="text-2xl font-black tracking-tight mb-4">{ex.name}</h2>

            {/* Sets table header — same columns as the live logger, minus the edit affordances */}
            <div className="grid grid-cols-12 gap-2 mt-2 mb-3 pt-3 border-t border-zinc-900 mono text-[10px] tracking-widest text-zinc-600">
              <div className="col-span-1">#</div>
              <div className="col-span-1"></div>
              <div className="col-span-3">{ex.assisted ? 'ASSISTANCE' : 'WEIGHT'}</div>
              <div className="col-span-2">REPS</div>
              <div className="col-span-1 text-center">TGT RIR</div>
              <div className="col-span-3 text-center">RIR</div>
              <div className="col-span-1"></div>
            </div>

            {ex.sets.map((set, sIdx) => (
              <div key={sIdx} className="grid grid-cols-12 gap-2 mb-2 items-center">
                <div className="col-span-1 mono text-zinc-500">{sIdx + 1}</div>
                <div className="col-span-1 flex justify-center">
                  {set.technique && TECHNIQUES[set.technique] && (
                    <span title={TECHNIQUES[set.technique].label}
                      className={`px-1 py-0.5 mono text-[9px] font-bold border ${TECHNIQUES[set.technique].color}`}>
                      {TECHNIQUES[set.technique].abbr}
                    </span>
                  )}
                </div>
                <div className="col-span-3 mono text-sm text-zinc-100">{set.weight || '—'}</div>
                <div className="col-span-2 mono text-sm text-zinc-100">{set.reps ?? '—'}</div>
                <div className="col-span-1 text-center mono text-sm text-zinc-500">{set.rirTarget}</div>
                <div className="col-span-3 text-center mono text-sm text-zinc-100">{set.rirActual ?? '—'}</div>
                <div className="col-span-1"></div>
              </div>
            ))}

            {/* Nav between exercises */}
            <div className="grid grid-cols-2 gap-2 mt-6">
              <button onClick={() => setActiveExIdx(Math.max(0, activeExIdx - 1))}
                disabled={activeExIdx === 0}
                className="bg-zinc-900 border border-zinc-800 py-3 disabled:opacity-30 mono text-xs tracking-widest">
                ← PREV
              </button>
              <button onClick={() => setActiveExIdx(Math.min(exercises.length - 1, activeExIdx + 1))}
                disabled={activeExIdx === exercises.length - 1}
                className="bg-zinc-900 border border-zinc-800 py-3 disabled:opacity-30 mono text-xs tracking-widest">
                NEXT →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// FEEDBACK FORM
// ============================================================================
function FeedbackForm({ muscles, feedback, setFeedback, onBack, onSubmit }) {
  const setField = (muscle, field, value) => {
    setFeedback({ ...feedback, [muscle]: { ...(feedback[muscle] || {}), [field]: value } });
  };

  const allComplete = muscles.every(m =>
    feedback[m]?.pump !== undefined && feedback[m]?.soreness !== undefined && feedback[m]?.workload
  );

  return (
    <div className="min-h-screen bg-black text-zinc-100 pb-24">
      <style>{FONT_STYLE}</style>
      <div className="border-b border-zinc-800 px-5 py-4 sticky top-0 bg-black z-10">
        <button onClick={onBack} className="text-zinc-400 text-sm flex items-center gap-1">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
      </div>
      <div className="px-5 py-6">
        <h2 className="text-2xl font-black tracking-tight mb-1">Recovery feedback</h2>
        <p className="text-zinc-500 text-sm mb-6">Drives next session's prescription.</p>

        {muscles.map(muscle => (
          <div key={muscle} className="mb-6 border border-zinc-800 p-4">
            <div className="mono text-xs tracking-[0.2em] text-amber-400 mb-4">{muscle.toUpperCase()}</div>

            <FieldLabel>PUMP (0 none → 3 huge)</FieldLabel>
            <ScaleRow value={feedback[muscle]?.pump} onChange={v => setField(muscle, 'pump', v)} max={3} />

            <FieldLabel>SORENESS FROM LAST (0 none → 3 crippling)</FieldLabel>
            <ScaleRow value={feedback[muscle]?.soreness} onChange={v => setField(muscle, 'soreness', v)} max={3} />

            <FieldLabel>WORKLOAD</FieldLabel>
            <div className="grid grid-cols-3 gap-2">
              {[
                { v: 'too-easy', l: 'EASY' },
                { v: 'manageable', l: 'JUST RIGHT' },
                { v: 'too-hard', l: 'TOO HARD' },
              ].map(opt => (
                <button key={opt.v} onClick={() => setField(muscle, 'workload', opt.v)}
                  className={`py-2 mono text-[10px] tracking-widest border ${feedback[muscle]?.workload === opt.v ? 'bg-amber-400 text-black border-amber-400' : 'bg-zinc-900 border-zinc-800 text-zinc-400'}`}>
                  {opt.l}
                </button>
              ))}
            </div>
          </div>
        ))}

        <button onClick={onSubmit} disabled={!allComplete}
          className="w-full bg-amber-400 text-black py-4 font-bold tracking-wide disabled:opacity-30 disabled:cursor-not-allowed">
          {allComplete ? 'SUBMIT SESSION →' : 'COMPLETE ALL FIELDS'}
        </button>
      </div>
    </div>
  );
}

function FieldLabel({ children }) {
  return <div className="mono text-[10px] tracking-widest text-zinc-500 mb-2 mt-3">{children}</div>;
}

function ScaleRow({ value, onChange, max }) {
  return (
    <div className="grid grid-cols-4 gap-2 mb-3">
      {Array(max + 1).fill(0).map((_, i) => (
        <button key={i} onClick={() => onChange(i)}
          className={`py-3 mono font-bold border ${value === i ? 'bg-amber-400 text-black border-amber-400' : 'bg-zinc-900 border-zinc-800 text-zinc-400'}`}>
          {i}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// CONFIRM MODAL — replaces native confirm() which is blocked in artifact iframes
// ============================================================================
function ConfirmModal({ title, message, confirmLabel = 'CONFIRM', cancelLabel = 'CANCEL', onConfirm, onCancel, danger = false }) {
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-5"
      onClick={onCancel}>
      <div className="bg-zinc-950 border border-zinc-800 p-6 max-w-sm w-full"
        onClick={e => e.stopPropagation()}>
        <div className={`mono text-xs tracking-widest mb-2 ${danger ? 'text-red-400' : 'text-amber-400'}`}>
          {title}
        </div>
        <div className="text-zinc-300 text-sm mb-6 leading-relaxed">{message}</div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onCancel}
            className="bg-zinc-900 border border-zinc-800 py-3 text-zinc-300 mono text-xs tracking-widest">
            {cancelLabel}
          </button>
          <button onClick={onConfirm}
            className={`py-3 font-bold mono text-xs tracking-widest ${danger ? 'bg-red-500 text-white' : 'bg-amber-400 text-black'}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Standalone popup version of the TODAY ONLY / REST OF MESO / CANCEL choice
// swap and add already show inline within their own open panels. Used where
// that choice needs to interrupt on its own (the reorder settle-prompt, and
// delete — which has no "configure a replacement" step to be inline within,
// so it gets the same prominent standalone treatment as reorder instead of
// swap's inline row). `danger` reddens the title and REST OF MESO only —
// TODAY ONLY stays amber even under danger, since for delete specifically
// it isn't actually destructive (the exercise stays in the program; only
// REST OF MESO removes it), and the color should track severity per-option,
// not blanket the whole modal because one of its choices is severe.
function ScopeConfirmModal({ title, message, onTodayOnly, onRestOfMeso, onCancel, danger = false }) {
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-5"
      onClick={onCancel}>
      <div className="bg-zinc-950 border border-zinc-800 p-6 max-w-sm w-full"
        onClick={e => e.stopPropagation()}>
        <div className={`mono text-xs tracking-widest mb-2 ${danger ? 'text-red-400' : 'text-amber-400'}`}>{title}</div>
        <div className="text-zinc-300 text-sm mb-6 leading-relaxed">{message}</div>
        <div className="grid grid-cols-3 gap-2">
          <button onClick={onTodayOnly}
            className="py-3 bg-amber-400 text-black mono text-[10px] font-bold tracking-wider">
            TODAY ONLY
          </button>
          <button onClick={onRestOfMeso}
            className={`py-3 border mono text-[10px] font-bold tracking-wider ${danger ? 'border-red-500 text-red-400 hover:bg-red-500 hover:text-white' : 'border-amber-400 text-amber-400 hover:bg-amber-400 hover:text-black'}`}>
            REST OF MESO
          </button>
          <button onClick={onCancel}
            className="py-3 border border-zinc-700 text-zinc-400 mono text-[10px] font-bold tracking-wider hover:border-zinc-500">
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// NAV MENU — full-screen overlay accessed via header menu icon
// ============================================================================
function NavMenu({ currentView, onNav, onClose }) {
  const items = [
    { label: 'HOME', view: 'home', icon: Home },
    { label: 'SETTINGS', view: 'settings', icon: Settings },
    { label: 'CUSTOM EXERCISES', view: 'customExercises', icon: Edit3 },
  ];

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <style>{FONT_STYLE}</style>
      <div className="border-b border-zinc-800 px-5 py-4 flex items-center justify-between">
        <span className="mono text-xs tracking-[0.2em] text-zinc-400">MENU</span>
        <button onClick={onClose} className="text-zinc-400 hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 px-5 py-6 space-y-2">
        {items.map(item => {
          const Icon = item.icon;
          const active = currentView === item.view;
          return (
            <button key={item.view} onClick={() => onNav(item.view)}
              className={`w-full flex items-center gap-4 p-4 border ${active ? 'border-amber-400 bg-amber-400/5 text-amber-400' : 'border-zinc-800 text-zinc-300 hover:border-zinc-600'}`}>
              <Icon className="w-5 h-5" />
              <span className="mono text-sm tracking-widest font-bold">{item.label}</span>
              {active && <span className="ml-auto mono text-[10px] text-amber-400/70">CURRENT</span>}
            </button>
          );
        })}
      </div>
      <div className="px-5 py-4 border-t border-zinc-800 mono text-[10px] tracking-widest text-zinc-600 text-center">
        HYPER · LOG · MESO ENGINE
      </div>
    </div>
  );
}

// ============================================================================
// SETTINGS VIEW
// ============================================================================
function SettingsView({ prefs, setPrefs, customExercises, onManageCustom, onResetAll, onSignOut, exportData, onBack }) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [exportStatus, setExportStatus] = useState(null);
  const totalCustom = Object.values(customExercises || {}).reduce((acc, arr) => acc + (arr?.length || 0), 0);

  const handleExport = async () => {
    try {
      setExportStatus('Preparing export…');
      const payload = {
        appName: 'HYPER · LOG',
        appVersion: 'v0.1',
        exportedAt: new Date().toISOString(),
        storage: exportData,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.download = `hyperlog-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportStatus('Download triggered · check your Files / Downloads');
      setTimeout(() => setExportStatus(null), 6000);
    } catch (e) {
      setExportStatus('Error: ' + String(e));
    }
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 pb-12">
      <style>{FONT_STYLE}</style>
      <div className="border-b border-zinc-800 px-5 py-4 sticky top-0 bg-black z-10 flex items-center gap-3">
        <button onClick={onBack} className="text-zinc-400 flex items-center gap-1 text-sm">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <span className="mono text-xs tracking-[0.2em] text-zinc-400 ml-2">SETTINGS</span>
      </div>
      <div className="px-5 py-6">
        <h2 className="text-2xl font-black tracking-tight mb-6">Preferences</h2>

        <div className="mb-6">
          <label className="mono text-xs tracking-[0.15em] text-zinc-500 block mb-2">UNITS</label>
          <div className="grid grid-cols-2 gap-2">
            {['lbs', 'kg'].map(u => (
              <button key={u} onClick={() => setPrefs({ ...prefs, units: u })}
                className={`py-3 mono font-bold uppercase border ${prefs.units === u ? 'bg-amber-400 text-black border-amber-400' : 'bg-zinc-900 border-zinc-800 text-zinc-400'}`}>
                {u}
              </button>
            ))}
          </div>
          <p className="mono text-[10px] text-zinc-600 tracking-wider mt-2">
            APPLIES TO NEW MESOS · EXISTING MESOS KEEP THEIR ORIGINAL UNITS
          </p>
        </div>

        <div className="mb-6">
          <label className="mono text-xs tracking-[0.15em] text-zinc-500 block mb-2">HOME GYM MODE</label>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setPrefs({ ...prefs, homeGym: false })}
              className={`py-3 mono font-bold uppercase border ${!prefs.homeGym ? 'bg-amber-400 text-black border-amber-400' : 'bg-zinc-900 border-zinc-800 text-zinc-400'}`}>
              OFF
            </button>
            <button onClick={() => setPrefs({ ...prefs, homeGym: true })}
              className={`py-3 mono font-bold uppercase border ${prefs.homeGym ? 'bg-amber-400 text-black border-amber-400' : 'bg-zinc-900 border-zinc-800 text-zinc-400'}`}>
              ON
            </button>
          </div>
          {!prefs.homeGym ? (
            <p className="mono text-[10px] text-zinc-600 tracking-wider mt-2 leading-relaxed">
              PRIORITIZES EXERCISES MATCHING YOUR AVAILABLE EQUIPMENT · BARBELL · DUMBBELL · CABLE · MACHINE · SMITH · CALISTHENICS
            </p>
          ) : (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-2">
                <label className="mono text-[10px] tracking-[0.15em] text-zinc-500">AVAILABLE EQUIPMENT</label>
                <span className="mono text-[10px] tracking-wider text-zinc-600">
                  {(prefs.equipment || []).length} / {ALL_EQUIPMENT_VALUES.length}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {EQUIPMENT_CATEGORIES.map(cat => {
                  const isOn = (prefs.equipment || []).includes(cat.value);
                  return (
                    <button key={cat.value}
                      onClick={() => {
                        const cur = prefs.equipment || [];
                        const next = isOn
                          ? cur.filter(v => v !== cat.value)
                          : [...cur, cat.value];
                        setPrefs({ ...prefs, equipment: next });
                      }}
                      className={`py-3 mono text-xs font-bold uppercase tracking-wider border ${isOn ? 'bg-amber-400 text-black border-amber-400' : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-600'}`}>
                      {cat.label}
                    </button>
                  );
                })}
              </div>
              <p className="mono text-[10px] text-zinc-600 tracking-wider mt-3 leading-relaxed">
                TAP TO TOGGLE · UNSELECTED EQUIPMENT IS HIDDEN FROM EXERCISE PICKER · CUSTOM EXERCISES ALWAYS SHOWN
              </p>
            </div>
          )}
        </div>

        <div className="mb-8">
          <label className="mono text-xs tracking-[0.15em] text-zinc-500 block mb-2">CUSTOM EXERCISES</label>
          <button onClick={onManageCustom}
            className="w-full text-left p-4 bg-zinc-900 border border-zinc-800 hover:border-amber-400">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold mb-1">Manage Library</div>
                <div className="mono text-[10px] text-zinc-500 tracking-wider">
                  {totalCustom} CUSTOM EXERCISE{totalCustom === 1 ? '' : 'S'}
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-zinc-600" />
            </div>
          </button>
        </div>

        <div className="mt-10 pt-6 border-t border-zinc-900">
          <label className="mono text-xs tracking-[0.15em] text-zinc-500 block mb-2">BACKUP</label>
          <button onClick={handleExport}
            className="w-full bg-zinc-900 border border-zinc-800 py-3 text-zinc-300 mono text-xs tracking-widest font-bold hover:border-amber-400">
            EXPORT MY DATA
          </button>
          <p className="mono text-[10px] text-zinc-600 tracking-wider mt-2 leading-relaxed">
            DOWNLOADS A JSON FILE WITH YOUR ACTIVE MESO, CUSTOM EXERCISES, VIDEO LINKS, AND PREFERENCES · SAVE IT SOMEWHERE SAFE
          </p>
          {exportStatus && (
            <p className={`mono text-[10px] tracking-wider mt-2 ${exportStatus.startsWith('Error') ? 'text-red-400' : 'text-amber-400'}`}>
              {exportStatus}
            </p>
          )}
        </div>

        <div className="mt-10 pt-6 border-t border-zinc-900">
          <label className="mono text-xs tracking-[0.15em] text-zinc-500 block mb-2">ACCOUNT</label>
          <button onClick={onSignOut}
            className="w-full bg-zinc-900 border border-zinc-800 py-3 text-zinc-300 mono text-xs tracking-widest font-bold hover:border-amber-400">
            SIGN OUT
          </button>
        </div>

        <div className="mt-10 pt-6 border-t border-red-900/30">
          <label className="mono text-xs tracking-[0.15em] text-red-400 block mb-2">DANGER ZONE</label>
          <button onClick={() => setConfirmingReset(true)}
            className="w-full bg-zinc-900 border border-red-900 py-3 text-red-400 mono text-xs tracking-widest font-bold hover:bg-red-950">
            RESET ALL DATA
          </button>
          <p className="mono text-[10px] text-zinc-600 tracking-wider mt-2">
            PERMANENTLY ERASES YOUR ACTIVE MESO, CUSTOM EXERCISES, VIDEO LINKS, AND PREFERENCES
          </p>
        </div>

        <div className="mt-12 pt-6 border-t border-zinc-900 text-center">
          <div className="mono text-xs tracking-[0.2em] text-zinc-500 mb-2">HYPER · LOG</div>
          <div className="mono text-[10px] tracking-widest text-zinc-600">v0.1 PROTOTYPE</div>
        </div>
      </div>

      {confirmingReset && (
        <ConfirmModal
          title="RESET ALL DATA"
          message="This permanently erases your active mesocycle, custom exercises, video links, and preferences. Cannot be undone."
          confirmLabel="ERASE EVERYTHING"
          danger={true}
          onConfirm={() => { setConfirmingReset(false); onResetAll(); }}
          onCancel={() => setConfirmingReset(false)}
        />
      )}
    </div>
  );
}

// ============================================================================
// CUSTOM EXERCISES VIEW — list, view video, and delete
// ============================================================================
function CustomExercisesView({ customExercises, exerciseVideos, onDelete, onBack }) {
  const [confirmingId, setConfirmingId] = useState(null);

  useEffect(() => {
    if (!confirmingId) return;
    const t = setTimeout(() => setConfirmingId(null), 3000);
    return () => clearTimeout(t);
  }, [confirmingId]);

  const allCustom = Object.entries(customExercises || {}).flatMap(([muscle, list]) =>
    (list || []).map(ex => ({ ...ex, muscle }))
  );

  const handleDeleteClick = (ex) => {
    if (confirmingId === ex.id) {
      onDelete(ex.id, ex.muscle);
      setConfirmingId(null);
    } else {
      setConfirmingId(ex.id);
    }
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <style>{FONT_STYLE}</style>
      <div className="border-b border-zinc-800 px-5 py-4 sticky top-0 bg-black z-10 flex items-center gap-3">
        <button onClick={onBack} className="text-zinc-400 flex items-center gap-1 text-sm">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <span className="mono text-xs tracking-[0.2em] text-zinc-400 ml-2">CUSTOM EXERCISES</span>
      </div>
      <div className="px-5 py-6">
        <h2 className="text-2xl font-black tracking-tight mb-1">Your library</h2>
        <p className="text-zinc-500 text-sm mb-6">
          {allCustom.length === 0 ? 'No custom exercises yet.' : `${allCustom.length} exercise${allCustom.length === 1 ? '' : 's'} across ${new Set(allCustom.map(e => e.muscle)).size} muscle group${new Set(allCustom.map(e => e.muscle)).size === 1 ? '' : 's'}`}
        </p>

        {allCustom.length === 0 ? (
          <div className="text-center py-12 border border-zinc-900">
            <Dumbbell className="w-12 h-12 mx-auto text-zinc-700 mb-4" strokeWidth={1.5} />
            <p className="text-zinc-500 mono text-xs tracking-widest mb-2">NO CUSTOM EXERCISES YET</p>
            <p className="text-zinc-600 text-xs max-w-xs mx-auto leading-relaxed">
              Create them via the <span className="text-amber-400">+ ADD CUSTOM EXERCISE</span> option in any muscle's exercise dropdown during meso setup.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {allCustom.map(ex => {
              const videoUrl = exerciseVideos?.[ex.id];
              const isConfirming = confirmingId === ex.id;
              return (
                <div key={ex.id} className="border border-zinc-800 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold truncate">{ex.name}</div>
                      <div className="mono text-[10px] tracking-widest text-zinc-500 mt-1">
                        {ex.muscle.toUpperCase()}{ex.assisted && ' · ASSISTED'}{videoUrl && ' · HAS VIDEO ▶'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {videoUrl && (
                        <a href={videoUrl} target="_blank" rel="noopener noreferrer"
                          className="bg-amber-400 border border-amber-400 w-9 h-9 flex items-center justify-center hover:bg-amber-300"
                          title="Watch video">
                          <Play className="w-3.5 h-3.5 text-red-600" fill="currentColor" />
                        </a>
                      )}
                      <button onClick={() => handleDeleteClick(ex)}
                        className={`border w-9 h-9 flex items-center justify-center ${isConfirming ? 'bg-red-500 border-red-500 text-white' : 'bg-zinc-900 border-zinc-800 text-red-400 hover:bg-red-950'}`}
                        title={isConfirming ? 'Tap again to confirm' : 'Delete custom exercise'}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {isConfirming && (
                    <p className="mono text-[10px] tracking-widest text-red-400 mt-3">
                      ⚠ TAP TRASH AGAIN TO CONFIRM · EXISTING MESO SNAPSHOTS WILL BE PRESERVED
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthGate>
      {({ trainingData, saveTrainingData, signOut }) => (
        <AppInner
          trainingData={trainingData}
          saveTrainingData={saveTrainingData}
          signOut={signOut}
        />
      )}
    </AuthGate>
  );
}
