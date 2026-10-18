# How Meal Prep sets your nutrition

A plain-language guide to every rule Meal Prep uses to set your calorie and macro targets, judge your weight trend, and adjust over time, and how well each rule is supported.

Source of truth: `src/App.jsx`. When a rule here and the code disagree, the code wins; update this guide alongside rule changes. RepReport's training rules are in `docs/progression-rules.md` in the RepReport repo.

---

## How sure we are about each rule

Every rule below carries one of three tags.

- **Research-backed.** Studies support the *idea*. They don't prove the exact number the app uses.
- **Coaching practice.** A sensible, common approach (often from RP or MacroFactor-style coaching), but not tested directly in a study.
- **App's choice.** A number or cutoff the app picked. That doesn't make it wrong; nobody has tested that exact value.

---

## 1. How the pieces fit

| Piece | What it is |
|---|---|
| **Targets** (presets) | Named macro targets (protein, fat, carbs, calories): Cut, Mini-cut, Maintenance, Bulk, and day-only targets such as a refeed |
| **Diet phases** | Blocks on the calendar (cut, maintenance, bulk) that say which target you follow on each date |
| **Weekly plan** | A Mon–Sun meal template. It isn't a record of what you ate. |
| **Food log** | What you actually ate. Checking off a meal copies its foods in, with their macros at that moment, so later edits to the plan or a food never change what was logged. |
| **Weigh-ins** | Prompted once a day (you can skip) |

The weekly check-in ties these together: it compares what you logged with how your weight moved, estimates your real maintenance, and suggests new targets.

---

## 2. Targets

- **New accounts start with example targets.** They're marked as examples, so nothing treats them as your real maintenance until you edit them or use the calculator. *(App's choice)*
- **Day overrides:** any weekday can use a different target than the phase, for example a Saturday refeed. Day-only targets can't be picked as a diet phase, so RepReport never mistakes a refeed for a cut.
- **Target history:** every change to a target is dated, so a past day is always judged against the target it had then.

### Starting targets calculator
A first estimate of maintenance from a short profile. The weekly check-in corrects it once you have a few weeks of data.

- **Calories at rest:**
  - Mifflin-St Jeor by default, accurate to about ±10% for most non-obese adults (Frankenfield 2005). *(Research-backed)*
  - With a body-fat %, a lean-mass equation (Tinsley 2019), since weight-only equations underestimate muscular people. *(Research-backed)*
- **Daily movement** outside the gym: × 1.3 (mostly sitting), 1.45 (some walking), 1.6 (on your feet), 1.75 (physical work). *(Coaching practice: standard activity factors, not measurements)*
- **Lifting**, added on top: about 4 kcal per kg of bodyweight per session (an hour at ~5 METs), averaged over the week. *(Research-backed rate; the session length is the app's choice)*
  - With an active RepReport block, lifting days are filled in from it. Without one, you enter them (see [section 7](#7-how-meal-prep-uses-repreport)).

From that maintenance, each target is built:
- **Calories:** maintenance plus the phase's default rate (below).
- **Protein:** at the floor in [section 5](#macro-split).
- **Fat:** 20% of calories on a cut or a refeed, 25% otherwise.
- **Carbs:** the rest.

*(Research-backed ranges; exact splits are the app's choice)*

---

## 3. Diet phases

**Which phase is in effect on a date:** the latest-starting phase on or before that date that hasn't been closed. A later phase simply takes over from an earlier one, so you can plan ahead without closing anything. RepReport resolves phases with the same rule.

### Target rate of weight change
Stored per phase as % of bodyweight. Cuts are shown per week; bulks per **month**, because a week of bulk gain is smaller than day-to-day noise.

| Phase | Default | Warning past | Won't save past |
|---|---|---|---|
| **Cut** | −0.7%/week | −1.0%/week | −1.5%/week |
| **Mini-cut** (a cut named "mini") | −1.0%/week | −1.25%/week | −1.5%/week |
| **Bulk** | +1%/month | +2%/month | +4%/month |
| **Maintenance** | 0 (±0.25%/week counts as on target) | — | — |

*(Research-backed ranges: Helms 2014 for 0.5–1%/week on a cut; Garthe 2011 for the fastest rate studied; Iraki 2019 for bulks. Mini-cut numbers are coaching practice.)*

### Planned length
- **Defaults:** mini-cut 4 weeks, cut 12, bulk 16, maintenance open-ended. You can change each one. *(Coaching practice: RP norms)*
- **Maintenance after a block is added for you** when you plan a cut or bulk with an end date:
  - after a cut: about ⅔ of the cut's length
  - after a bulk: 2, 3 or 4 weeks, for bulks up to 8, up to 16, or longer
  - after a mini-cut: none, because it goes straight back into the bulk
  - after a cut or bulk that continues an earlier one (below), the length counts the whole run: 4 weeks after a 9-week bulk, a 4-week mini-cut and an 8-week bulk (17 weeks of bulk); about 11 after a 10-week cut, a 2-week diet break and a 6-week cut (16 weeks of cut). That's the length the training effect fades over, so the two always agree. *(Owner's choice, Oct 2026)*

  *(Coaching practice: RP Diet 2.0, Israetel, McDonald; no trial behind the exact lengths)*
- **Moving or skipping maintenance is your call.** Starting a cut or bulk without the suggested maintenance shows a one-line note, but never blocks you.
- **Back-to-back blocks of the same type chain together** for the training-volume effect and RepReport's strength check ([section 7](#7-how-meal-prep-uses-repreport)). A short maintenance between two cuts works as a diet break: the effect pauses rather than resetting. The second cut chains when it starts before the first one's fade runs out (2/3 of its length, so about 6½ weeks after a 10-week cut), even if the scale stalled at the end of the first.
- **A bulk that resumes after a mini-cut is the same bulk.** The mini-cut is there to extend the bulk, so the bulk's clock stops while it runs, however long it lasts, and the bulk picks up its training-volume effect where it stood. Maintenance days around the mini-cut still count against the bulk's 2–4-week fade.

---

## 4. Weigh-ins and your weight trend

- **Trend:** a straight line fitted through every weigh-in in the last **2 weeks**. It's ready only when each of those weeks has **4 or more weigh-ins**, since a single weigh-in swings 1–2% on water alone. RepReport uses the same rule. *(Coaching practice; 4 is the app's choice)*
- **Bulks use 4 weeks:** the last 7 days and days 22–28 ago each need 4+ weigh-ins, and the rate is scaled to a month.
- **Pace on the phase card:**
  - **On pace:** within ±0.2%/week of target on a cut, or ±0.25%/month on a bulk.
  - **Off pace:** otherwise, shown as "Losing slower than target", "Not gaining yet", and similar.
  - **Maintenance:** "Holding steady" within ±0.25%/week.
- **Projection:** the phase card shows your projected weight at the planned end date, at your target pace.

*(App's choice for the tolerances)*

---

## 5. Maintenance estimate and the weekly check-in

Meal Prep estimates your real maintenance from what you logged and how your weight moved. It's the same idea as MacroFactor. *(Coaching practice)*

### The estimate
- **Data window:** the last 21 days, ending yesterday.
- **Needs:** at least 10 complete logged days, 8 weigh-in days, and 2 weeks of weight data.
- **Raw estimate:** average calories on counted days, minus the energy of the weight change (about 3,500 kcal per lb, a standard approximation).
- **Each check-in moves 30% of the way toward the new raw estimate, and never more than ±150 kcal.** One odd week can't swing your targets.
- **Starting point:** your Maintenance target's calories, if you've set them yourself rather than keeping the example.

*(App's choice for the window, minimums, 30% and ±150)*

**Which days count:**
- A day counts if you logged food.
- A day logged at **under half its target** is assumed to be partly logged and left out, unless you mark it as counting. Partial days would look like eating less than you did.
- You can mark any past day either way.

### The weekly check-in
Shown on Monday, or later that week if you missed it, until you complete it:
1. **Confirm** which of last week's days were fully logged.
2. **See** the maintenance estimate, your actual rate against the phase target, and suggested targets.
3. **Choose** Apply, Adjust (edit first) or Keep current. Every decision is saved.

**Suggested targets:**
- **Calories:** maintenance plus whatever produces your phase's target rate, moved **at most ±250 kcal** per check-in.
- **A warning appears** if the result implies losing more than 1% of bodyweight a week.
- **Suggestions only appear once the estimate rests on your own data,** never on the starting guess alone.

*(Research-backed for the 1% ceiling; the ±250 cap is the app's choice)*

### Macro split
For any calorie target:
- **Protein:** never cut; raised to at least **2.0 g/kg** on a cut (Helms 2014) or **1.6 g/kg** otherwise (Morton 2018). *(Research-backed)*
- **Fat:** kept, but never below **20% of calories** (Helms 2014: 15–30%). *(Research-backed range; 20% is the app's choice)*
- **Carbs:** the rest.

---

## 6. Logging food

- **Foods** are either components, with macros stored directly, or recipes, with ingredients and a number of servings.
- **Barcodes** look foods up in Open Food Facts.
- **Checking off a meal** copies its foods into the log with their macros at that moment.
- **Past days** can be marked as counting or not toward the estimate (see [section 5](#5-maintenance-estimate-and-the-weekly-check-in)).

---

## 7. How Meal Prep uses RepReport

RepReport saves a small status with your training data:
- whether a block is **active**
- its days per week
- the last block's days per week
- whether this is the **deload week**
- during a cut, **whether your lifts are holding up** (see [Strength during a cut](#strength-during-a-cut))
- while a block is running, **its goal**: what it's for, which muscles you're pushing, its main lifts and its dates (see [Your training goal](#your-training-goal-from-repreport))

**A block counts as active** while it has sessions left. A finished block that hasn't been archived or replaced yet doesn't count.

| In Meal Prep | Block active | No active block |
|---|---|---|
| **Calculator: lifting days per week** | Filled in, labeled "from your current RepReport block" | Left for you to enter: "No active RepReport block — enter how often you lift right now (your last block was 5 days/week)." |
| **Phase card: training volume impact** | Shows how your diet phase is moving your volume ceilings | Still shows it, plus "No active RepReport block — this applies when you start one." |

**Training volume impact** is a copy of RepReport's diet-phase math:
- A cut lowers every muscle's recovery ceiling (MRV) by up to **20%**, and a bulk raises it by up to **10%**. The shift builds over the phase and scales with how fast your weight is actually moving: full effect at 1% a week lost or 0.5% gained.
- A cut's first weeks use your planned pace instead: its first week loses mostly water, and until the cut has its own trend the 14-day trend still reads the phase before. The cut's trend counts from day 20, once its 14 days start after the first week. The planned pace also stands in whenever there are no weigh-ins. The card says so: "assuming you're losing 0.7%/week (your planned pace). From Nov 2, your weigh-ins set it (a cut's first week is mostly water)." Same rule in RepReport.
- A mini-cut takes 30% off from day 1, even straight after a bulk: a bulk that's still fading doesn't offset it, since a mini-cut's deficit is what calls for the 30%. The weight trend only counts once its 2 weeks of weigh-ins all fall inside the mini-cut, because before that it still reads the phase before (a bulk's gain would hold the cut back). After that it follows the scale (during a gap in weigh-ins, the latest trend made only of mini-cut weigh-ins): the full 30% at the default mini-cut pace of 1% a week or faster, about 22% at 0.75% a week, 15% at 0.5% a week.
- A flat or slower scale pauses the build-up rather than undoing it: during the phase the effect holds at the highest level the weight trend kept for a full week (one lucky weigh-in can't set it), and the fade afterwards starts from there. *Example:* a 10-week cut at 1% a week whose scale goes flat for the last 2 weeks stays at −15% instead of dropping to 0%. A slowdown you chose holds the same way. The card then says "held at the most this cut has built up (the scale now: −0.5%/week)", or "(your last trend, 5 days ago: …) … Weigh in to update it." when weigh-ins have stopped.
- Effects fade after the phase ends.

*Example:* halfway through a 12-week cut losing 1% a week, the bar reads −10% and chest MRV in RepReport goes from 20 to 18 sets. At the end of that cut it reads −20% (chest 16). At the end of a bulk gaining 0.5% a week it reads +10% (chest 22).

The bar runs from −30% to +30%. RepReport's progression guide explains the details. *(Research-backed that energy balance affects recovery. The −20% and +10% are the owner's coaching choices, Oct 2026; the other numbers are the app's choice)*

**During the deload week**, the training volume impact drops the percentage and its explanation, and shows:

> Deload week in RepReport: sets are cut about in half and loads lightened so you can recover. Keep calories as planned — eating less would work against that.

Calorie targets don't change. The lighter week saves only about 70–140 kcal a day of training, and eating less would work against the recovery the deload is for. *(Coaching practice)*

### Your training goal (from RepReport)
While a RepReport block is running, the phase card shows one line on what the block and your phase are doing together, with the pace you planned here: "Building chest and upper back on a bulk (+1%/month).", "Holding muscle on a mini-cut (−1%/week).", "Building muscle at maintenance: expect slow, steady gains." RepReport shows the same line in its diet box. Words like "lean" or "aggressive" wait until their limits are agreed.

A warning appears under it when the two pull apart:
- **A bulk while no muscle is above Maintain** in the block: "Your block holds every muscle at maintenance volume, so a bulk mostly adds fat. Change the block's goal in RepReport, or switch to maintenance calories in Meal Prep." Chest on Maintain gets 3–4 sets a week, below the 5 where growth starts. A Strength block isn't flagged; a surplus suits it.
- **A strength or powerbuilding block on a cut faster than 0.7% a week:** "On a cut this fast, holding your main lifts is the win, and RepReport won't add sets to them. PRs are unlikely until you're back at maintenance. If PRs matter more right now, slow the cut to 0.7% a week or less in Meal Prep." Below 0.7% a week strength can still climb (Garthe et al. 2011: athletes losing 0.7% a week improved every lift tested, those losing 1.4% only squat). The pace is the cut's held pace, as RepReport reads it.

*(Cutoffs are the owner's choices, Oct 2026)*

**While planning a phase,** the phase editor runs the same check against your running RepReport block, at the pace you're entering (a blank rate is checked at the default the editor shows: 0.7% a week for a cut, 1% for a mini-cut). The phase running today is checked at the pace the scale has held, the same reading as the card above, so the editor and the card agree. A phase that starts partway through the block also gets a note on the weeks it covers, naming the deload week (the block's last, lighter week) when it falls inside: "Your mini-cut starts in week 4 of this block (weeks 4–6; week 6 is your deload)." The volume bar shows what the phase does to training, so the note doesn't repeat it. RepReport's block setup shows the same notes for a block you're planning.

### Strength during a cut
During a cut or mini-cut, the phase card shows a **Strength (from RepReport)** section. RepReport works out whether your lifts are holding up since the cut began: a line through every week of the cut for each exercise, comparing week 1s with week 1s and week 2s with week 2s, and counting the reps in reserve you logged. Its guide has the details. Losing strength steadily on a cut is the clearest sign you may be losing muscle.

| What RepReport sees | What the phase card shows |
|---|---|
| Fewer than 3 muscles with a score yet | "Strength since the cut began: not enough sessions yet to compare." |
| Before the trend line exists (in practice until part of a second block), no crash | "checking. The full comparison starts once you've repeated weeks of an earlier block in this cut." |
| Lifts holding | "Strength since the cut began: holding (−1%)" |
| Lifts down, but no heads-up yet | "Strength since the cut began: down about 4%" |
| Most muscles more than 3% down, two readings in a row | **Heads-up**, e.g. "your lifts are down about 3% across 5 of 7 muscles since the cut began (Bench Press: 225×7 (2 left) → 225×6 (2 left)). Nothing to change yet. Worth watching." |
| Most muscles more than 5% down (more than 8% before the trend line exists) | **Suggestion**: the same line plus "Losing 1.1% a week may be costing muscle." and two buttons |

A reading more than a week old gets "(as of Oct 10)" added.

The suggestion's buttons:
- **Slow to 0.5%/week (+430 kcal/day)**: sets the cut's target pace to −0.5%/week (today's phase and any later planned rows of the same cut) and raises the cut target's calories by about 2.5 kcal a day per pound of bodyweight for each 0.5% a week, in one step. Carbs take the change; protein and fat floors apply as usual. It only appears when the cut is faster than 0.5%/week and the phase has targets to raise; otherwise the card suggests a 1–2 week diet break at maintenance on the calendar.
- **Keep current**: changes nothing.

Either answer quiets the suggestion for 2 weeks, unless lifts drop another 2 points. The card says the day it comes back. The answer is saved on your account, so it holds on every device, and signing out clears it from the app.

*Why the full change at once:* the check-in's ±250 kcal weekly limit is there so one noisy week can't swing your targets. Slowing the cut is your decision, not a correction from noisy data. *(Owner's choice, Oct 2026)*

**A diet break doesn't start the check over.** A cut that chains onto the one before it ([section 3](#3-diet-phases)) is the same cut to the strength check, so "since the cut began" still means the first cut's start. *Example:* a 10-week cut, a 2-week break, then 6 more weeks: in the second cut's week 3, the card still compares with the first cut's week 1.

The section is hidden when RepReport's reading is for a different cut than the one on your calendar (for example, one that ended before a longer maintenance), and the heads-up and suggestion are hidden when the reading is more than 3 weeks old. A malformed reading is ignored rather than shown.

### Logic shared with RepReport: keep in step
These live in both apps. A change to one must be made in the other:
- the diet-phase resolution rule ([section 3](#3-diet-phases))
- the weight-trend rule ([section 4](#4-weigh-ins-and-your-weight-trend))
- the diet-phase effect on volume ceilings: the −20% cut and +10% bulk shares, the mini-cut cut, and how blocks chain
- the 18+ and terms consent, and account export and deletion
- the strength-during-a-cut reading: RepReport computes it (`computeCutStrength`) and Meal Prep only displays and acts on it (`strengthView`); the field names in between must match
- the goal check (`goalCheck`, `goalPhaseOf`, `goalPlanCheck`), wording included: RepReport writes the goal (`buildGoalStatus`), both apps run the same check on it

---

## Open problems

- **Goal words wait for limits.** The goal line gives your pace as a number. Words like "lean" or "aggressive" need agreed limits first (see [Your training goal](#your-training-goal-from-repreport)).
- **Duplicated logic can drift.** The shared rules above are copied, not shared code, so a change in one app can silently disagree with the other.

---

## Sources

- **Weight-loss rate and protein on a cut:** Helms et al. 2014, evidence-based recommendations for natural bodybuilding contest preparation.
- **Fast vs slow weight loss in athletes:** Garthe et al. 2011.
- **Rate of gain when bulking:** Iraki et al. 2019, nutrition recommendations for bodybuilders in the off-season.
- **Protein for muscle gain:** Morton et al. 2018, meta-analysis of protein supplementation and resistance training.
- **Resting energy equations:** Frankenfield et al. 2005 (Mifflin-St Jeor accuracy); Tinsley et al. 2019 (lean-mass equation for athletes).
- **Energy cost of resistance training:** Compendium of Physical Activities.
- **Phase lengths and post-diet maintenance (coaching sources, not trials):** RP Diet 2.0; Israetel; McDonald.
