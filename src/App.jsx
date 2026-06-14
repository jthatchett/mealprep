import React, { useState, useEffect, useMemo, useCallback } from "react";

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

// fetch the user's app_data row
async function sbLoadAppData(session) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/app_data?select=foods,phases,week&user_id=eq.${session.user.id}`,
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

// upsert the user's app_data row
async function sbSaveAppData(session, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_data`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      user_id: session.user.id,
      foods: data.foods,
      phases: data.phases,
      week: data.week,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error("Failed to save data: " + res.status + " " + err);
  }
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

/* ---------- default day ---------- */
function newDay(phaseId) {
  return {
    phaseId: phaseId || "phase-maintenance",
    slots: [
      { id: uid(), name: "Meal 1", entries: [] },
      { id: uid(), name: "Meal 2", entries: [] },
      { id: uid(), name: "Meal 3", entries: [] },
      { id: uid(), name: "Meal 4", entries: [] },
    ],
  };
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
  const [activeDay, setActiveDay] = useState("Mon");
  const [debugLog, setDebugLog] = useState([]);
  const [session, setSession] = useState(null);     // null = not yet checked
  const [sessionChecked, setSessionChecked] = useState(false);
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

  const signOut = async () => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setStore(null);
    setLoaded(false);
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
    (async () => {
      const seedWeek = () => {
        const w = {};
        DAYS.forEach((d) => (w[d] = newDay("phase-maintenance")));
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
          if (Object.keys(idRemap).length > 0) {
            const patched = {};
            for (const [day, val] of Object.entries(loadedWeek)) {
              patched[day] = { ...val, phaseId: idRemap[val.phaseId] || val.phaseId };
            }
            loadedWeek = patched;
          }

          setStore({ foods: loadedFoods, phases: loadedPhases, week: loadedWeek });
        } else {
          // new user — seed defaults, will be saved on first change
          setStore({ foods: SEED_ALL, phases: SEED_PHASES, week: seedWeek() });
        }
      } catch (e) {
        dbg("LOAD FAILED: " + e.message);
        setStore({ foods: SEED_ALL, phases: SEED_PHASES, week: (() => { const w = {}; DAYS.forEach((d) => (w[d] = newDay("phase-maintenance"))); return w; })() });
      } finally {
        setLoaded(true);
      }
    })();
  }, [session]);

  // save — to Supabase, triggered by store changes
  useEffect(() => {
    if (!loaded || !store || !session) return;
    const t = setTimeout(() => {
      sbSaveAppData(session, store)
        .then(() => dbg("saved to supabase — foods:" + store.foods?.length + " phases:" + store.phases?.length))
        .catch((e) => dbg("SAVE FAILED: " + e.message));
    }, 400);
    return () => clearTimeout(t);
  }, [store, loaded, session]);

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
            phases={phases}
            activeDay={activeDay}
            setActiveDay={setActiveDay}
          />
        )}
        {tab === "foods" && (
          <Foods foods={foods} setFoods={setFoods} />
        )}
        {tab === "phases" && (
          <Phases phases={phases} setPhases={setPhases} />
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
function Plan({ week, setWeek, foods, phases, activeDay, setActiveDay }) {
  const day = week[activeDay];
  const phase = phases.find((p) => p.id === day.phaseId) || null;
  const [picker, setPicker] = useState(null); // slotId being edited

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

  return (
    <div>
      {/* day tabs */}
      <div style={S.dayRow}>
        {DAYS.map((d) => (
          <button
            key={d}
            onClick={() => setActiveDay(d)}
            style={{
              ...S.dayTab,
              ...(d === activeDay ? S.dayTabOn : {}),
            }}
          >
            {d}
          </button>
        ))}
      </div>

      {/* phase + target dashboard */}
      <div style={S.dash}>
        <div style={S.dashHead}>
          <label style={S.dashLabel}>PHASE</label>
          <select
            key={day.phaseId || "none"}
            value={day.phaseId || ""}
            onChange={(e) => update((d) => (d.phaseId = e.target.value || null))}
            style={S.select}
          >
            <option value="">— none —</option>
            {phases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <MacroBars total={dayTotal} target={phase ? phase.target : null} />
      </div>

      {/* meal slots — reorderable via up/down */}
      {day.slots.map((slot, si) => (
        <Slot
          key={slot.id}
          slot={slot}
          foods={foods}
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
          onAdd={() => setPicker(slot.id)}
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

      {picker && (
        <FoodPicker
          foods={foods}
          onClose={() => setPicker(null)}
          onPick={(foodId) => {
            update((d) => {
              const slot = d.slots.find((s) => s.id === picker);
              slot.entries.push({ foodId, qty: 1 });
            });
            setPicker(null);
          }}
        />
      )}
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
  onAdd,
  onQty,
  onRemoveEntry,
}) {
  const total = useMemo(() => {
    let t = ZERO;
    for (const e of slot.entries) {
      const food = foods.find((x) => x.id === e.foodId);
      if (food) t = addM(t, scale(foodMacros(food, foods), e.qty));
    }
    return t;
  }, [slot, foods]);

  return (
    <div style={S.slot}>
      <div style={S.slotHead}>
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
        <button style={S.xBtn} onClick={onRemoveSlot} title="remove slot">
          ✕
        </button>
      </div>

      {slot.entries.map((e, ei) => {
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

      <button style={S.addEntry} onClick={onAdd}>
        + food
      </button>
    </div>
  );
}

function FoodPicker({ foods, onPick, onClose }) {
  const [q, setQ] = useState("");
  const list = foods
    .filter((f) => f.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div style={S.modalWrap} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          <input
            autoFocus
            placeholder="search foods…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={S.search}
          />
          <button style={S.xBtn} onClick={onClose}>
            ✕
          </button>
        </div>
        <div style={S.modalList}>
          {list.map((f) => (
            <button key={f.id} style={S.pickItem} onClick={() => onPick(f.id)}>
              <span>
                {f.name}
                {f.verify && <span style={S.verifyDot}>●</span>}
                {f.type === "recipe" && <span style={S.recipeTag}>recipe</span>}
              </span>
              <span style={S.pickUnit}>per {f.unit}</span>
            </button>
          ))}
          {list.length === 0 && <div style={S.empty}>no match</div>}
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
                <span>flag “needs verification”</span>
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
function Phases({ phases, setPhases }) {
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
      <p style={S.note}>
        Phases are macro-target profiles. Assign one to a day in Plan and the
        bars measure against it. Targets reverse-engineered from your docs —
        adjust to your current numbers.
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
        Your data lives in this artifact’s storage. Export regularly — it’s your
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

  // day tabs
  dayRow: { display: "flex", gap: 4, marginBottom: 14 },
  dayTab: {
    flex: 1,
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
