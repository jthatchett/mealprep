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
| **Weekly plan** | Each week's Mon–Sun meal plan. A new week keeps your meals and day targets but starts with no foods. It isn't a record of what you ate. |
| **Food log** | What you actually ate. Checking off a meal copies its foods in, with their macros at that moment, so later edits to the plan or a food never change what was logged. |
| **Weigh-ins** | Prompted once a day (you can skip) |

The weekly check-in ties these together: it compares what you logged with how your weight moved, estimates your real maintenance, and suggests new targets.

---

## 2. Targets

- **New accounts start with example targets.** They're marked as examples, so nothing treats them as your real maintenance until you edit them or use the calculator. *(App's choice)*
- **Day overrides:** any weekday can use a different target than the phase, for example a Saturday refeed. It's set in that week's plan, and a new week starts with the previous week's overrides. Day-only targets can't be picked as a diet phase, so RepReport never mistakes a refeed for a cut.
- **Target history:** every change to a target is dated, so a past day is always judged against the target it had then. Every path below (editor saves, check-ins, a phase starting, targets following the estimate) changes a target from today; nothing rewrites a past day, a logged meal or a past check-in.

### The Phases tab
One card per saved target, plus the phase in effect and the maintenance estimate behind every number. *(Owner's design, Nov 2026)*

- **The phase in effect** (the same overview on the Plan tab's card and on Phases) leads with where you are ("CUT · WEEK 6 / 12", a progress bar and its dates), then **what the scale is doing in pounds**: "Losing 0.8 lb / week · On pace · goal 0.9 lb / week" (the same 2-week trend and on-pace tolerance as the Plan card; bulks per month over 4 weeks). Until that trend exists it shows the goal in pounds ("Lose 0.9 lb / week") and when the actual pace will show. Calories sit below, against maintenance in kcal ("2,050 kcal / day · 450 under your 2,500 maintenance"), the same on both cards; Phase History says it the same way ("450 under maintenance"). *(Owner's request, Nov 2026)*
- **Your weight in the phase:** Start (maintenance: Holding, the weight it holds, see [Maintenance holds your starting weight](#maintenance-holds-your-starting-weight)), Now and (cuts and bulks) Goal at the planned end, each a week's average of weigh-ins, then one line: "On plan you'd be at 176.2 today: 1.8 lb behind" (cuts and bulks) or "Down 3.5 lb since this maintenance started 10 weeks ago". The 2-week pace can't see a slow drift: −0.2%/week reads "Holding steady" at maintenance indefinitely, about 3.5 lb over 10 weeks at 180 lb. *(Owner's request, Nov 2026)*
  - **No weigh-ins around a cut's or bulk's start:** Start is your first full week of weigh-ins after it (the first 7 days with 3+), and the plan line runs from the middle of that week ("Start 162.2 lb · Oct 10–16", "Starting from your first full week of weigh-ins (Oct 10–16)."). Until then: "No weigh-ins around Sep 9: the plan will start from your first full week of weigh-ins (3 in 7 days)." Maintenance does the same, plus a 4-week-gap reset (see [Maintenance holds your starting weight](#maintenance-holds-your-starting-weight)); a cut or bulk has no gap reset, since it's planned from its start. *(Owner's choice, Nov 2026)*
- **The maintenance estimate** is labeled by source: **learned** (the latest check-in, from your data), **your number** (a check-in Edit with different calories), or **starting estimate** (your Maintenance target, before your data takes over; see [section 5](#5-maintenance-estimate-and-the-weekly-check-in)). With none, it says so and points to the calculator. A due check-in's new estimate shows as "would move it to …, not applied until you finish the check-in".
- **Phase Targets:** each card shows its goal in pounds at your weight ("Lose 0.9 lb/wk", a bulk "Gain 1.8 lb/mo", maintenance "Hold your weight", a refeed "One day"; tap it to edit the rate), calories and macros, and ACTIVE or PLANNED (with the date) when it is. Its change history is in the editor's ⋯ menu. *(Owner's design, Nov 2026)* *(App's choice)*

### Editing a target
**Rate → calories → macros.** Calories are calculated, never typed (except a one-day target's, and Maintenance's while it's the starting estimate; see below).

- **The editor shows four things, in order:** the goal in pounds ("Lose 0.9 lb / week"), the calories it gives ("2,050 → 1,870"), the macros, and Save. Under the calories, one line: "Maintenance 2,500 kcal · this goal is 450 kcal/day under it." Name, use, history and remove are in the ⋯ menu. *(Owner's request, Nov 2026, after ranking what each line was doing)*
- **The rate** is stored as % of bodyweight and shown in pounds at your weight. −/+ step it by 0.1%/week on a cut (about 0.2 lb at 180 lb) or 0.25%/month on a bulk (about 0.45 lb), or type it (cuts lose, bulks gain). The limits in [section 3](#3-diet-phases) apply: a warning past them, no save past the hard limit. *(Step sizes are the owner's choice, Nov 2026)*
- **Calories from the rate:** the estimate plus what the pace needs (1% of bodyweight a week = bodyweight × 35 kcal a day), to the nearest 10. *Example:* 2,500 kcal maintenance, 180 lb, 0.5%/week → 2,500 − 450 = **2,050**.
- **Macros balance inside those calories** (4 kcal/g protein and carbs, 9 kcal/g fat, whole grams):
  - protein or fat changed → carbs take the difference
  - carbs changed → fat takes the difference

  *Example:* 165 P / 70 F / 190 C = 2,050. Fat to 74 → carbs 181. Carbs to 199 instead → fat 66. Calories stay at 2,050.
- **Rounding:** whole grams can't always land exactly (1 g of fat is 2¼ g of carbs), so the macros may total up to half a gram of the balancing macro off the target: ±2 kcal when carbs balance, ±4.5 when fat does. The editor doesn't call out a few kcal of rounding; the save check still holds the total within these limits. *Example:* fat 71 → carbs 188 → 2,051. *(App's choice)*
- **Fat is at least 20% of the target's calories,** one-day targets included, rounded **up** to a whole gram so it never lands under 20%: 2,000 kcal → 45 g (44 g is 19.8%), 2,050 → 46 g, 2,250 → 50 g. It moves with the calories. *(Owner's choice, Nov 2026)*
- **When the calories change** (a new rate, a new estimate, a phase starting), protein and fat stay, carbs take the difference, and fat rises to its new minimum if needed. Each macro changed from what's saved shows "was 190 g" under it.
- **What can't be saved, and why:** fat under its minimum ("…carbs can be 245 g at most"), carbs below 0 because protein and fat already exceed the calories ("Lower fat to 50 g or less, or protein to 355 g or less"), or a total off the target by more than the rounding above. The save button stays off and nothing is adjusted for you: never protein, the calories, the rate or anything in RepReport.
- **Protein and carbs have no hard limits** beyond 0 yet. Protein under the check-in's floor ([Macro split](#macro-split)) gets a note, not a block. *(Owner's decision pending, Nov 2026)*

**Which phase an edit changes:**
- **A preset not in effect:** its rate is its **default rate**, the one new phases start or are planned at (a blank rate on the calendar uses it too), and the one its calories are calculated at. Saving applies the calculated calories. Phases already on the calendar keep their own rates; the editor lists them.
- **The phase in effect:** the rate is that phase's own (its diet_phases row, which RepReport reads). Changing it moves the applied calories by the difference the two paces need at your weight, the same as "Slow to 0.5%/week", so a check-in's step still in progress or a Keep carries over instead of jumping. *Example:* estimate 2,500, kept at 2,250 on a −0.7% cut (1,870 by the numbers); −0.5% → 2,430. It shows how far that is from what the estimate and pace give, and why ("You chose Keep at the Nov 2 check-in" / "A check-in moves calories at most 250 kcal a week"), with **Use 2,050** to take the full number at once (your choice, not capped, like the Slow button). A checkbox also makes the new rate the preset's default; otherwise the default is untouched. Saved from today; past days keep their targets. The calendar's rate edit for the phase in effect moves its calories the same way. Only that row changes: later planned phases keep their rates. *(Owner's request, Nov 2026)*
- **Macro-only edits never change the calories,** and no edit here moves the maintenance estimate.

### Targets follow the estimate
- **Automatically, all the time:** whenever the app has your estimate, weigh-ins and targets loaded (opening it, a check-in, a weigh-in, editing the starting maintenance), every phase target not in use that's **50+ kcal** off what the estimate and its goal give is brought in line: calories to the new number, protein and fat kept (fat up to its 20% minimum), carbs take the difference, dated in its history. *Example:* estimate 2,500 at 180 lb, Mini-cut at 0.6%/week: 2,500 − 540 = 1,960, so a Mini-cut sitting at 1,770 moves to 1,960; a Bulk at 2,707 against 2,710 stays. The 50 kcal keeps weight changes alone from nudging the cards every few days: the goal part of a 0.5%/week cut moves only ~25 kcal over 10 lb; maintenance itself moves more (~65–100 kcal per 10 lb), and the check-ins pick that up as they learn it. Never changed this way: the target in use (only check-ins, a phase starting, your edits), one-day targets, goal rates, past days; nor, while the estimate is still your Maintenance target, Maintenance itself. Existing accounts line up once, the first time the app opens after this. *(Owner's choice, Nov 2026; replaces the "Update" button)*
- **Presets not in effect follow each recorded estimate from your data:** when a check-in is completed (Use, Edit or Keep), every cut, bulk and maintenance preset not in effect is recalculated at the new estimate and its own default rate, with protein and fat kept. Unlike the check-in's suggestion, the protein floor isn't applied here, and there's no ±250 cap: nobody is eating those targets yet. The card shows "Updated Nov 9: was 2,050". *(Owner's request, Nov 2026)*
- **A phase that starts gets a fresh target:** when a phase comes into effect (a switch, a planned start date arriving, maintenance after a cut), its preset is recalculated from the recorded estimate and **that phase's own rate**, once per phase. *Example:* estimate 2,560, a planned cut at −0.5% starts → 2,110, whatever the Cut preset held. Without an estimate (or, for a cut or bulk, a weigh-in) the saved target is kept. The first time this runs on an existing account it only records which phase is in effect; nothing changes. *(Owner's request, Nov 2026)*
- **One-day targets (refeeds) don't follow the estimate.** A refeed has no weekly rate, so its calories are set directly in its editor, which shows them against the estimate ("+608 kcal vs your 2,500 maintenance estimate, +24%") and the days it's used. The calculator still sets a refeed to maintenance calories, as before. Your number is never overwritten by a new estimate. *(App's choice: a refeed is a deliberate day, not a pace)*
- **Maintenance while it's the starting estimate:** its calories are the starting estimate itself, so they stay editable (labeled "Starting maintenance estimate") until a check-in learns your real one; after that they're calculated like the rest.

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
Stored per phase as % of bodyweight. Each preset also has a default rate (the phase type's below unless you change it on the Phases tab): what a new phase starts at. A phase on the calendar keeps its own rate. Cuts are shown per week; bulks per **month**, because a week of bulk gain is smaller than day-to-day noise.

| Phase | Default | Warning past | Won't save past |
|---|---|---|---|
| **Cut** | −0.7%/week | −1.0%/week | −1.5%/week |
| **Mini-cut** (a cut named "mini") | −1.0%/week | −1.25%/week | −1.5%/week |
| **Bulk** | +1%/month | +2%/month ("faster tends to add more fat") | +4%/month |
| **Maintenance** | 0 (±0.25%/week counts as on target) | — | — |

*(Research-backed ranges: Helms 2014 for 0.5–1%/week on a cut; Garthe 2011 for the fastest rate studied; Iraki 2019 for bulks. Mini-cut numbers are coaching practice.)*

### Planned length
- **Defaults:** mini-cut 4 weeks, cut 12, bulk 16, maintenance open-ended. You can change each one. *(Coaching practice: RP norms)* Only maintenance and bulks can be open-ended: every cut and mini-cut has an end date. *(Owner's choice, Nov 2026)*
- **Maintenance after a block is added for you** when you plan a cut or bulk with an end date:
  - after a cut: about ⅔ of the cut's length
  - after a bulk: 2, 3 or 4 weeks, for bulks up to 8, up to 16, or longer
  - after a mini-cut: none planned, because it goes straight back into the bulk. If nothing is planned after it, open-ended maintenance follows it, so it never stays a deficit by accident. *(Owner's choice, Nov 2026)*
  - after a cut or bulk that continues an earlier one (below), the length counts the whole run: 4 weeks after a 9-week bulk, a 4-week mini-cut and an 8-week bulk (17 weeks of bulk); about 11 after a 10-week cut, a 2-week diet break and a 6-week cut (16 weeks of cut). That's the length the training effect fades over, so the two always agree. *(Owner's choice, Oct 2026)*

  *(Coaching practice: RP Diet 2.0, Israetel, McDonald; no trial behind the exact lengths)*
- **A plan never leaves you in a cut or bulk.** A cut, mini-cut or bulk found past its planned end with nothing after it (its maintenance deleted, say) is ended and followed by open-ended maintenance when the app opens. *(Owner's choice, Nov 2026)*
- **Moving or skipping maintenance is your call.** Starting a cut or bulk without the suggested maintenance shows a one-line note, but never blocks you.
- **Back-to-back blocks of the same type chain together** for the training-volume effect and RepReport's strength check ([section 7](#7-how-meal-prep-uses-repreport)). A short maintenance between two cuts works as a diet break: the effect pauses rather than resetting. The second cut chains when it starts before the first one's fade runs out (2/3 of its length, so about 6½ weeks after a 10-week cut), even if the scale stalled at the end of the first.
- **A long cut offers a diet break.** Once the phase card's cut has run **12 weeks**, it adds: "This cut has run 13 weeks. A 1–2 week break at maintenance is an option; studies find about the same fat loss either way. Your next RepReport deload starts Nov 14." The deload part shows only with a running RepReport block. It counts from the current cut's own start, so a cut right after a break starts over; mini-cuts get no note. *(Trials used 2–3 weeks of dieting per break and found fat loss about the same as continuous dieting: MATADOR, Byrne et al. 2018; ICECAP, Peos et al. 2021. No study supports a specific interval, so 12 weeks, about two RepReport blocks, is the owner's choice, Oct 2026)*
- **A bulk that resumes after a mini-cut is the same bulk.** The mini-cut is there to extend the bulk, so the bulk's clock stops while it runs, however long it lasts, and the bulk picks up its training-volume effect where it stood. Maintenance days around the mini-cut still count against the bulk's 2–4-week fade.

---

## 4. Weigh-ins and your weight trend

- **Trend:** a straight line fitted through every weigh-in in the last **2 weeks**. It's ready only when each of those weeks has **4 or more weigh-ins**, since a single weigh-in swings 1–2% on water alone. RepReport uses the same rule. *(Coaching practice; 4 is the app's choice)*
- **Bulks use 4 weeks:** the last 7 days and days 22–28 ago each need 4+ weigh-ins, and the rate is scaled to a month.
- **After a change of phase, the pace waits for the new phase's own trend:** no verdict until day 20 (day 28 for a bulk's monthly trend), on any cut and on any phase that follows a different one. The first week after a change swings with water (lost starting a cut, regained coming off one), and the 2-week trend would also still read the phase before. Until then the card says when the pace will show. *Example:* coming off a cut at 172 lb, with 1.5 lb of water back in the first week and then flat, day 14 would read "Drifting up" (+0.42%/week); day 20 reads "Holding steady". *(Owner's choice, Nov 2026)*
- **Pace on the phase card:**
  - **On pace:** within ±0.2%/week of target on a cut, or ±0.25%/month on a bulk.
  - **Off pace:** otherwise, shown as "Losing slower than target", "Not gaining yet", and similar.
  - **Maintenance:** "Holding steady" within ±0.25%/week.
- **Projection:** the phase card shows your projected weight at the planned end date, at your target pace.
- **Behind plan (cuts and bulks):** the 2-week pace can read "On pace" while the phase as a whole is behind (slow early weeks). Once you're more than a week of the goal pace behind the plan line from your start (0.9 lb on a 0.5%/week cut at 180 lb), the label turns amber: "▲ On pace now · 1.8 lb behind plan". Calories never drop on their own to catch up. **Get back on plan**, on the Plan tab's phase card where the pace shows every day, offers three ways, each redrawing the plan from today's weight *(owner's choice, Nov 2026)*:
  - **Finish Plan Later:** "Reach your goal (170.1 lb) by Jan 9 at the same 0.9 lb/wk": the same goal at the same pace, a later end date (and the maintenance after it moves too). *Example:* 178.0 lb, goal 170.1 → Jan 9 instead of Dec 26. Not offered into a phase already planned after it.
  - **Same Date, Adjusted Goal:** "Reach 171.9 lb by Dec 26 at the same 0.9 lb/wk".
  - **Same Date, Same Goal, Faster:** "Reach your goal (170.1 lb) by Dec 26 by increasing your rate of loss to 1.1 lb/wk" (0.64%/week). It gets the usual rate checks: a warning past them ("…Finish Plan Later avoids that."), and it isn't offered past the 1.5%/week limit. RepReport reads the new rate.
  - An open-ended bulk has no end to move: **Plan from today** only.

*(App's choice for the tolerances)*

---

## 5. Maintenance estimate and the weekly check-in

Meal Prep estimates your real maintenance from what you logged and how your weight moved. It's the same idea as MacroFactor. *(Coaching practice)*

### The estimate
- **Data window:** the last 21 days, ending yesterday.
- **Needs:** at least 10 complete logged days, 8 weigh-in days, and 2 weeks of weight data.
- **Raw estimate:** average calories on counted days, minus the energy of the weight change (about 3,500 kcal per lb, a standard approximation).
- **Each check-in moves 30% of the way toward the new raw estimate, and never more than ±150 kcal.** One odd week can't swing your targets.
- **Except the first one with enough data, when the estimate so far is only a starting guess: your own data replaces the guess outright.** A calculator guess is only good to about ±10%, so it shouldn't hold you back from your real maintenance for weeks. That week's calories still move at most ±300 kcal; later check-ins close any rest. *Example:* guess 2,840, first reading 3,050 → estimate 3,050, calories +210. *(Owner's choice, Nov 2026, over a 60% step that left the guess pulling for several more weeks)*
- **Faster when the data agrees:** after that first one, when last week's check-in and this week's both put your maintenance on the same side of the estimate, the move is 50%, at most ±250 kcal. *Example:* estimate 2,500; last week's data said 2,300 (estimate → 2,440); this week's says 2,250 → 2,345, where 30% would give 2,383. A one-off spike never gets the faster step, and neither does the week after an Adjust (see next). *(Owner's choice, Oct 2026)*
- **Your Adjust sticks:** choosing Adjust makes the calories you picked the new estimate (less what the phase's target pace adds), so the next check-in starts from your number instead of pulling you back. *Example:* at maintenance with the estimate at 2,500, you Adjust to 2,150; with next week's data at 2,300, it suggests 2,195, not ~2,390. *(Owner's choice, Oct 2026)*
- **Starting point:** your Maintenance target's calories, if you've set them yourself rather than keeping the example.

*(App's choice for the window, minimums, 30% and ±150; owner's choice for replacing the first guess, 50%/±250 and Adjust sticking)*

**Which days count:**
- A day counts if you logged food.
- A day logged at **under half its target** is assumed to be partly logged and left out, unless you mark it as counting. Partial days would look like eating less than you did.
- You can mark any past day either way.

### The weekly check-in
Shown on Monday, or later that week if you missed it, until you complete it:
1. **Confirm** which of last week's days were fully logged.
2. **See** the maintenance estimate, your actual rate against the phase target, and suggested targets.
3. **Choose** Use, Edit or Keep. Every decision is saved.
   - **Use:** the suggestion becomes the target in effect.
   - **Edit:** calories have their own field; macros balance inside them as in the Phases editor (fat at least 20%). Changing the calories is the Adjust above: they become the estimate, less the pace. Keeping the suggested calories and changing only the split is recorded as a Use and leaves the estimate alone. *(Owner's choice, Nov 2026: before, any split change counted as an Adjust, so a split tweak on a capped week could move the estimate)*
   - **Keep:** the target in effect doesn't change.
   - **At maintenance the check-in does itself:** once the estimate rests on your data, the week's check-in is completed with its suggestion when you open the app, and Plan shows "Weekly check-in: Calories 2,500 → 2,681" with **OK** and **Something off?**. Cuts and bulks still ask Use / Edit / Keep. The first one from your data says what it replaced: "Your real maintenance is 2,680 calories. That's 180 more than the starting estimate. Each weekly check-in fine-tunes it from your latest logging and weigh-ins." *(Owner's wording, Nov 2026; numbers are kept out of comma runs like "2,680, 180", which read as one long number)*
   - **Something off?** offers the reasons someone at maintenance wouldn't want the change, each with its own fix, so none of them turns into a quiet, lasting Keep *(owner's choice, Nov 2026)*:
     - **My log was incomplete** → the check-in is withdrawn and last week's days open to fix; it runs again from them.
     - **My weight is temporarily off** (travel, illness, a salty weekend, the menstrual cycle) → "Got it. Your calories stay at 2,500 this week. Next week's check-in will update them again."
     - **I want to lose or gain slowly** → a slow cut (−0.25%/week, ≈0.45 lb at 180) or bulk (+0.5%/month) starts today at its usual length (cut 12 weeks, bulk 16), then maintenance. Calories and the end date show before you tap.
     - **Hold my current weight instead** → only while winning back a drift: the weight to hold becomes today's, and calories go to plain maintenance.
     - **I can't eat that right now** → only when the change is 150 kcal or 6% of calories, whichever is less (2,500 → 150; 1,700 → 102): smaller changes are the estimate's routine weekly steps (at most ±150) and within logging error. Offers "Meet halfway: 2,591 · you'll lose about 0.2 lb a week" or "Stay at 2,500 this week · you'll lose about 0.4 lb a week". One week only; the next check-in applies the full number. Two weeks running, it adds: "If this is what you can eat, a slow cut makes it the plan instead of a drift", with the slow option. *(150 kcal / 6% is the owner's choice, Nov 2026)* *Why:* a Keep or a skipped check-in let maintenance drift: guessed at 2,500 with a real maintenance of 2,680, someone keeping 2,500 is 5.4 lb down after 15 weeks; with the check-ins applied they hold at 179.3. *(Owner's choice, Nov 2026)*
   - Whichever you pick, the presets not in effect follow the new estimate once it rests on your data ([Targets follow the estimate](#targets-follow-the-estimate)).

The card keeps it short: which days count, the estimate's change this week (old → new), and the suggested targets. It doesn't show the raw 3-week number on its own, since that single reading swings with water weight; the estimate only moves part way toward it. *(Owner's request, Nov 2026)*

**Suggested targets:**
- **Calories:** maintenance plus whatever produces your phase's target rate, moved **at most ±250 kcal** per check-in (±300 on that first data-based check-in, when the estimate jumps to your own data).
- **Except at maintenance, where there's no step:** calories go straight to your maintenance (plus any catch-up). The estimate from your data is already trusted in full, and stepping toward it held people under or over maintenance for extra weeks, still drifting. *Example:* calculator 2,140, real 2,680: the old step gave 2,440 in week 1 (still 240 under, still losing); now 2,680, or 2,884 with a 2.4 lb catch-up. The cost: a noisy first estimate (a water swing can put it ~±150 off) goes in as is; the estimate's 30% steps take it out over a few weeks, about 1 lb at most, within day-to-day range. Simulated with the app's functions, a 20%-low calculator lands within 25 kcal of the real maintenance even with water spikes, and holding weight is back by week 9–12 with no overshoot. *(Owner's choice, Nov 2026)*
- **A warning appears** if the result implies losing more than 1% of bodyweight a week.
- **Suggestions only appear once the estimate rests on your own data,** never on the starting guess alone.

*(Research-backed for the 1% ceiling; the ±250 cap is the app's choice)*

### Eating well off target
A food log alone can't tell eating less from logging less, so this warning needs the scale to agree. *(Owner's choice, Nov 2026)*
- **When:** over the 7 days ending yesterday, on fully logged days (at least 4), you averaged **250+ kcal under** each day's target (a refeed day against its own), **and** the 2-week trend shows you losing faster than your goal by more than the card's on-pace band: 0.2%/week on a cut (a 0.5%/week cut: 0.7%/week or faster, about 1.3 lb at 180 lb). The mirror counts too: 250+ over on a bulk while gaining faster than 0.25%/month past its goal; and at maintenance, either way, outside the steady ±0.25%/week.
- *Examples, a 0.5%/week cut at 2,050:* 1,750 logged and losing 1.4 lb/wk → warning. 1,750 logged but losing 0.9 → none (likely a logging gap). 2,050 logged and losing 1.4 → none (maintenance is higher than estimated; the check-in raises calories). 1,900 logged → none (inside normal logging error).
- **What it shows:** "▲ EATING UNDER TARGET · LAST 7 DAYS", two tiles, **You ate** 1,750 kcal/day (−300 vs 2,050 target) and **Losing** 1.4 lb/week (0.5 faster than your 0.9 goal; at maintenance "Drifting down · goal: hold steady"), then "Losing faster than your goal costs muscle." (a bulk: "Gaining faster than your goal mostly adds fat."). **Behind plan** (and off in the direction of the goal), it adds "If you're trying to catch up, push your end date back instead." with the three ways back on plan already open; either way **Got it** closes it. Shown on Plan with that week's check-in, at most once a week.
- *(250 kcal and the 4-day minimum, the same as RepReport's protein summary, are the app's choice; the scale bands are the card's own)*

### What sets a starting weight
A phase's starting weight (a cut's or bulk's Start, maintenance's Holding) is an average of **at least 3 weigh-ins**, so one salty or dehydrated morning can't set it alone. *(Owner's choice, Nov 2026)*
- **3+ in the 7 days up to the start:** their average.
- **Fewer:** topped up with the first weigh-ins after the start, within 6 days, stopping at 3 (not the whole week, so a cut's or bulk's first-week water barely enters). *Example:* one weigh-in before the start, 164.0 after a salty dinner (real ~162.5), then 162.6 and 162.4: the start is 163.0, not 164.0. The plan line still runs from the start date.
- **Until it has 3 (inside the start week):** no start yet; no plan line, no catch-up. The card shows the average so far, "settling · 2 of 3", and says what's needed: "The weight to hold is the average of 3 weigh-ins around Sep 9. You have 2: weigh in on 1 more morning by Sep 15. First thing in the morning, after the bathroom, before eating or drinking."
- **Still fewer than 3 once the start week ends:** the first full week of weigh-ins (below).
- **Starting a phase:** the form says it up front: "Your start weight is the average of 3+ weigh-ins around the start. First thing in the morning, after the bathroom, before eating or drinking." (maintenance: "The weight it holds is…")
- *(3 is the owner's choice; the morning routine is standard weigh-in practice)*

### A cut's or bulk's start settles after the first week
A cut's first week drops water (less food, carbs and salt; a bulk's adds some), and it stays off (on) for the whole phase. A start taken from the week before leaves the plan line that much off: you look ahead of plan, and a stall shows as "behind" only once that cushion is used up. *(Owner's choice, Nov 2026)*
- **Weeks 1–3:** the week before stands in, marked provisional: "Start 163.0 lb · Dec 1 · provisional", "A cut's first week drops some water, so your start is refined once that settles (Dec 22)."
- **Day 22:** once weeks 2–3 each have 4+ weigh-ins (the pace's own rule), the start becomes the line through them, extended back to where a week's average up to the start sits (day −3; "Now" is a 7-day average too, so their lags cancel). The plan line keeps its start date. The card says, for two weeks: "Your start moved from 163.0 to 162.5 once the first week's water settled, so the plan leaves it out."
- **Weeks 2–3 short of 4 weigh-ins each:** the next pair of weeks can settle it (through week 5); the card says "Your start is refined once you have 2 weeks in a row with 4+ weigh-ins each. Weigh in most mornings." Past week 5, or once the phase has ended, it stays at the week before.
- **Not settled:** phases under 3 weeks (short mini-cuts), re-plans (they start from weigh-ins already past the water), and starts taken from a later first full week of weigh-ins (already past it).
- *Example (simulated with the app's functions):* 163.0 the week before, 0.8 lb of water lost in days 1–5, then 0.8 lb a week of fat: provisional, the card reads about 0.4 lb ahead; on Dec 22 the start settles at ~162.6 and it reads on plan. A stall from day 28 shows as behind about 4 days sooner; with a 1.5 lb first-week drop, about 10 days sooner.
- *Precision:* extending a 2-week line back about 10 days carries roughly ±0.3 lb of weigh-in noise.

### Maintenance holds your starting weight
Maintenance aims to keep you at the weight you began it at, not just to stop the scale moving. *(Owner's choice, Nov 2026)*
- **The weight it holds:** a week's average of weigh-ins (3 or more, see [What sets a starting weight](#what-sets-a-starting-weight)) up to the maintenance's start, or, after a cut or bulk, up to its day 19 (the day before its pace counts), once the water from the change has settled. The phase card shows it as "Holding 180.0 lb".
  - **No weigh-ins around the start** (you started weighing in later): it holds your **first full week of weigh-ins**, the first 7 days after the start with 3 or more. The card shows the week ("Holding 162.2 lb · Oct 10–16") and says "Holding your first full week of weigh-ins (Oct 10–16)."; until that week fills it says "No weigh-ins around Sep 9: maintenance will hold your first full week of weigh-ins (3 in 7 days)." *Example:* maintenance from Sep 9, first weigh-ins Oct 6 and Oct 10, then most days: Oct 6–12 has only 2, Oct 10–16 has 5 (avg 162.2), so it holds 162.2. With one weigh-in allowed, a single low morning (160.4) would have set it and started a catch-up for a drift that wasn't there.
  - **4+ weeks without weigh-ins** (since the held week began): the old number is stale, so it holds your **first full week back** instead, and the card says so. *Example:* held 162 in October, no weigh-ins November–February, back at 170 in March: it holds ~170 (no catch-up toward 162); until 3 weigh-ins come in, no hold. A 27-day gap keeps the old weight.
  - A catch-up counts its weeks from the week the held weight comes from. *(Owner's choice, Nov 2026: 3 weigh-ins in 7 days, 4-week gap)*
- **More than 1% away** (1.8 lb at 180 lb), each check-in aims to win back a quarter of what's left that week, as a pace on top of the estimate, **but never faster than the default bulk pace, +1%/month (about 0.23%/week)**, either way. Since any gap past 1% is over that, a catch-up runs at a steady ~0.4 lb a week (about +200 kcal/day at 176 lb) and eases off for the last ~1.6 lb. At maintenance the check-in moves calories there directly, with no weekly step. *(Owner's choice, Nov 2026: a quarter a week alone planned 0.50%/week in week 1, past the app's own +2%/month fast-bulk warning)*
- **It stops** once back within 0.25% (about 0.45 lb), or after 16 applied check-ins as a safety stop, and the check-ins hold from there. A Keep doesn't count as a week of it.
- *Example (simulated with the app's own functions):* real maintenance 2,680, guessed 2,500, targets kept for 10 weeks → 176.0 lb. From then on: 2,750, 2,891, 2,885 … 2,823, 2,779, 2,749, 2,678 kcal; back to 179.7 lb after 11 weeks, with no overshoot.
- **The week a catch-up starts, it asks first.** Instead of applying itself, the check-in states it and waits. *Example, the usual case (back from the holidays):* "You're 2.4 lb over your maintenance weight. You started maintenance at 180.0 lb on Oct 6. You're at 182.4 now. To get back: about 2,480 calories a day (210 under maintenance, ≈0.4 lb a week)." with **OK** or **Stay at 182.4 lb** (today's weight becomes the one to hold, and the check-in applies plain maintenance). A catch-up from the first weeks of learning your maintenance is rarer: it takes an onboarding estimate about 12% or more off. No forecast of weeks or of what the scale will do: the fact, the action, the pace. Later weeks lead with "1.4 lb to go · Back to 180.0 lb at about 0.4 lb a week", and the Plan card shows "Getting back to 180.0 lb · 1.4 lb to go" while it runs. *(Owner's design, Nov 2026)*
- A small drift (under 1%) is left to the estimate, and the phase card calls it "Within your normal day-to-day range" (one morning swings 1–2 lb on water and food): it learns your real maintenance within about 2 weeks of enough data, which stops it. *Example:* guessed 7% low, the person settles 0.7 lb under.

*(Owner's choice for holding the starting weight and the +1%/month cap; the 1% trigger, 0.25% stop, quarter-per-week and 16-week safety stop are the app's choice)*

### Macro split
For any calorie target:
- **Protein:** never cut; raised to at least **2.0 g/kg** on a cut (Helms 2014) or **1.6 g/kg** otherwise (Morton 2018). *(Research-backed)*
- **Fat:** kept, but never below **20% of calories**, rounded up to a whole gram (Helms 2014: 15–30%). *(Research-backed range; 20% is the owner's choice)*
- **Carbs:** the rest.

---

## 6. Logging food

- **Foods** are either components, with macros stored directly, or recipes, with ingredients and a number of servings.
- **Barcodes** look foods up in Open Food Facts.
- **Checking off a meal** copies its foods into the log with their macros at that moment.
- **Each week starts with no foods.** A week you haven't touched shows the meals and day targets (a Saturday refeed, say) of the latest saved week before it (or, before your first saved week, of that first week), with every meal empty. To reuse foods, a meal's **⋮** menu has **copy from last week** (next to copy to next day): it fills that empty meal from the latest earlier week the same meal on the same weekday had foods. A meal that already has foods isn't overwritten. Editing one week never changes a week you've already edited, this week, or anything you logged. Past plans keep their foods for 12 weeks; older weeks keep their meals and day targets, so old logs still line up under their meals, and the last week each weekday was planned keeps its foods so it can still be copied. When this shipped, the old repeating template became the previous week's plan, so it's one tap away. *(Owner's choice, Oct 2026)*
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

**The calendar marks the running block:** a line under each of its days, in the accent color for the deload week, so a diet break is easy to line up with a deload or the gap between blocks.

**Meal Prep sends RepReport a protein summary** in return, saved with your Meal Prep data:
- your average protein over the logged days of the last 7, ending yesterday (today is still being logged);
- the average of those days' protein targets (the diet phase's targets as they were that day, or the weekday's override, like a refeed);
- how many days counted.

A day counts if it counts toward the maintenance estimate ([section 5](#5-maintenance-estimate-and-the-weekly-check-in)) and every food has its protein; a calories-only quick add leaves that day out. RepReport shows it in its diet box and on its "Sets −1" note when protein averaged under 80% of target; it needs 4 logged days and never changes training. Saving it doesn't touch your plan or foods, so it can't cause a "changed on another device" conflict. *(Owner's choice, Oct 2026)*

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
- A cut whose scale never drops (or a bulk whose scale never rises) stays at 0% (no deficit shows up, so recovery isn't treated as reduced). From week 3, when a cut's own trend starts counting, the card says so: "Volume ceilings are at your normal baseline: your weight hasn't dropped since this cut started 5 weeks ago (now +0.1%/week), so RepReport plans as if you're at maintenance. If you're eating in a deficit, check your logging." A bulk whose scale doesn't rise gets the same from week 3 ("…hasn't risen since this bulk started… If you're eating in a surplus, check your logging."). Before week 3 (a mini-cut or a bulk; a cut's own trend starts in week 3) it keeps "…isn't affecting recovery yet." Same rule in RepReport. *(Owner's choice, Oct 2026)*
- Effects fade after the phase ends.

*Example:* halfway through a 12-week cut losing 1% a week, the bar reads −10% and chest MRV in RepReport goes from 20 to 18 sets. At the end of that cut it reads −20% (chest 16). At the end of a bulk gaining 0.5% a week it reads +10% (chest 22).

The bar runs from −30% to +30%. RepReport's progression guide explains the details. *(Research-backed that energy balance affects recovery. The −20% and +10% are the owner's coaching choices, Oct 2026; the other numbers are the app's choice)*

**During the deload week**, the training volume impact drops the percentage and its explanation, and shows:

> Deload week in RepReport: sets are cut about in half and loads lightened so you can recover. Keep calories as planned — eating less would work against that.

Calorie targets don't change. The lighter week saves only about 70–140 kcal a day of training, and eating less would work against the recovery the deload is for. *(Coaching practice)*

### Your training goal (from RepReport)
**Where it shows** *(Owner's call, Nov 2026)*: the phase card on Plan is Meal Prep's own (phase, weight, calories). Everything RepReport tells Meal Prep (the block line and any goal conflicts, diet-break and deload notes, Training volume impact, Strength during a cut, "No active RepReport block") sits in a separate **From RepReport** card right under it, in RepReport's amber, with "open ›" to repreport.app. Shown only while RepReport is connected. The phase card's dates say what follows ("Nov 1 – Jan 23 · then Maintenance"); with nothing planned after the phase, one line, always shown: "Next: nothing planned" (the card's "plan ›" opens the calendar; it replaced the dismissable "Planning a bulk or cut next?" reminder).

While a RepReport block is running, the **From RepReport** card (under the phase card) shows one line on what the block and your phase are doing together, with the pace you planned here: "Building chest and upper back on a bulk (+1%/month).", "Holding muscle on a mini-cut (−1%/week).", "Building muscle at maintenance: expect slow, steady gains." RepReport shows the same line in its diet box. Words like "lean" or "aggressive" wait until their limits are agreed.

A warning appears under it when the two pull apart:
- **A bulk while no muscle is above Maintain** in the block: "Your block holds every muscle at maintenance volume, so a bulk mostly adds fat. Change the block's goal in RepReport, or switch to maintenance calories in Meal Prep." Chest on Maintain gets 3–4 sets a week, below the 5 where growth starts. A Strength block isn't flagged; a surplus suits it.
- **A strength or powerbuilding block on a cut faster than 0.7% a week:** "On a cut this fast, holding your main lifts is the win, and RepReport won't add sets to them. PRs are unlikely until you're back at maintenance. If PRs matter more right now, slow the cut to 0.7% a week or less in Meal Prep." Below 0.7% a week strength can still climb (Garthe et al. 2011: athletes losing 0.7% a week improved every lift tested, those losing 1.4% only squat). The pace is the cut's held pace, as RepReport reads it.

*(Cutoffs are the owner's choices, Oct 2026)*

**While planning a phase,** the phase editor runs the same check against your running RepReport block, at the pace you're entering (a blank rate is checked at the default the editor shows: 0.7% a week for a cut, 1% for a mini-cut). The phase running today is checked at the pace the scale has held, the same reading as the card above, so the editor and the card agree. Only the goal warnings show; how to line phases up with training blocks is left to you or your coach. RepReport's block setup runs the same check for a block you're planning.

### Strength during a cut
During a cut or mini-cut, the **From RepReport** card shows a **Strength** section. RepReport works out whether your lifts are holding up since the cut began: a line through every week of the cut for each exercise, comparing week 1s with week 1s and week 2s with week 2s, scoring each exercise's first 2 sets and counting the reps in reserve you logged. Pull-ups and other bodyweight moves are scored only with at least 3 weigh-ins in the week before the session. Its guide has the details. Losing strength steadily on a cut is the clearest sign you may be losing muscle.

| What RepReport sees | What the phase card shows |
|---|---|
| Fewer than 3 muscles with a score yet | "Strength since the cut began: not enough sessions yet to compare." |
| Before the trend line exists (in practice until part of a second block), no crash | "checking. The full comparison starts once you've repeated weeks of an earlier block in this cut." |
| Lifts holding | "Strength since the cut began: holding (−1%)" |
| Lifts down, but no heads-up yet | "Strength since the cut began: down about 4%" |
| Most muscles more than 3% down, two readings in a row | **Heads-up**, e.g. "your lifts are down about 3% across 5 of 7 muscles since the cut began (Bench Press: 225×7, 225×7 (2 left) → 225×7, 225×5 (2 left)). Nothing to change yet. Worth watching." Both sets RepReport scored are shown; a reading from an older RepReport shows one. |
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
- the strength-during-a-cut reading: RepReport computes it (`computeCutStrength`) and Meal Prep only displays and acts on it (`strengthView`); the field names in between must match, including the example's `beforeSets`/`afterSets`
- the protein summary: Meal Prep computes it (`buildProteinStatus`) and saves it to `app_data.status` (`sbSaveStatus`); RepReport only displays it (`proteinSummary`); the field names in between must match
- the goal check (`goalCheck`, `goalPhaseOf`, `goalPlanCheck`), wording included: RepReport writes the goal (`buildGoalStatus`), both apps run the same check on it
- each phase's `target_rate_pct` (%/week): Meal Prep writes it (calendar, Phases tab, Slow button), RepReport reads it for a cut's planned pace and the goal line. A preset's default rate (`rate_pct`) lives only in Meal Prep's saved data, which RepReport never reads. Tests on both sides pin the effect of an edit (Meal Prep `tests/`, RepReport `tests/mealprep-rate-edit.test.js`).

---

## Open problems

- **Protein and carb limits.** Only the 20% fat minimum is enforced in the editor. Hard limits for protein and carbs are still to be decided.

- **Goal words wait for limits.** The goal line gives your pace as a number. Words like "lean" or "aggressive" need agreed limits first (see [Your training goal](#your-training-goal-from-repreport)).
- **Duplicated logic can drift.** The shared rules above are copied, not shared code, so a change in one app can silently disagree with the other.

---

## Sources

- **Weight-loss rate and protein on a cut:** Helms et al. 2014, evidence-based recommendations for natural bodybuilding contest preparation.
- **Fast vs slow weight loss in athletes:** Garthe et al. 2011.
- **Rate of gain when bulking:** Iraki et al. 2019, nutrition recommendations for bodybuilders in the off-season.
- **Diet breaks:** Byrne et al. 2018, MATADOR trial (Int J Obes); Peos et al. 2021, ICECAP secondary analysis (PLoS ONE), https://pmc.ncbi.nlm.nih.gov/articles/PMC7906362/
- **Protein for muscle gain:** Morton et al. 2018, meta-analysis of protein supplementation and resistance training.
- **Resting energy equations:** Frankenfield et al. 2005 (Mifflin-St Jeor accuracy); Tinsley et al. 2019 (lean-mass equation for athletes).
- **Energy cost of resistance training:** Compendium of Physical Activities.
- **Phase lengths and post-diet maintenance (coaching sources, not trials):** RP Diet 2.0; Israetel; McDonald.
