# Complete scenario examples

These four importable packages use the public scenario-mod format, the regular
simulation and the normal player controls. They keep the base scenario's researched
location, inherited fleet and ages. They are longer challenges than the short
[mechanism recipes](../authoring.md#executable-recipes).

Start with **Easy** (`Employee`); **Medium** (`Manager`) is also tested. Import a
JSON file from this directory through **Mods**, inspect its rules, then launch it.
The seed in the file makes each recommended route reproducible. A package's
`seed + 1` is a second tested weather/outage draw, not a promise about every seed
or the three other difficulties.

All months below are the author's one-based playable months: month 1 is the
opening month. A command scheduled for engine month 24 happens at the opening of
playable month 25. Pause before changing dispatch or ordering construction.
Capacity is in MW and prices are dollars per kWh. Facility quotes, loan interest
and construction times still use the selected difficulty, starting year and the
ordinary game economy; these routes do not inject money or a completed plant.

| Package                                                                 | Based on                | Months | Tested seeds   | Main decision                                                               |
| ----------------------------------------------------------------------- | ----------------------- | -----: | -------------- | --------------------------------------------------------------------------- |
| [Funded or phased connection](funded-or-phased-connection.json)         | 106, Data Center Boom   |    108 | 12345, 12346   | Take a grant and connect 100 MW at once, or connect two 50 MW phases.       |
| [Prepare before the freeze](prepare-before-freeze.json)                 | 107, Deep Freeze        |     60 | 268107, 268108 | Pay for winterization or fund more reserve capacity.                        |
| [Two dry years](two-dry-years.json)                                     | 114, The River Runs Dry |     48 | 42, 43         | Pay for conservation or accept fuel support independently in each year.     |
| [Retire coal without a bill shock](retire-coal-without-bill-shock.json) | 102, The End of an Era  |     36 | 12345, 12346   | Replace inherited coal while meeting the bill, debt and reliability limits. |

## Funded or phased connection

This package imports scenario 106's complete connection arc, including its
blocking decision. At month 49, **Accept funded connection** grants $15 million and
adds the full 100 MW data-center load from month 73. **Require phased connections** grants
nothing and adds 50 MW from month 73, then 50 MW from month 97. The load factor is
90%; a 100 MW connection therefore consumes 90 MW on average. Each company makes
its own choice.

The goals require at least **99.5% demand served in every month 73–108** and at
least **90% of starting residential customers retained at month 108**. The
data-center debrief counts months with blackouts during months 73–108 and compares
the recorded starting and ending electricity tariffs.

A winning route for either branch on both tested seeds:

1. Before starting the clock, finance a **100 MW Natural Gas Peaker** and set the
   electricity rate to **$0.12/kWh**.
2. Keep it available as reserve; its default dispatch position is suitable.
3. At month 49, answer either connection option and continue through month 108.

For the package's original seed **12345**, a financed **50 MW** peaker also wins
both branches on Easy and Medium. The browser journey and the two-company test
exercise that smaller route. In the two-company match, one company fast-tracks
and the other phases; their grant and connected-load schedules remain independent.

The downside is playable too: on Easy, seed 12345, set the same $0.12 rate,
**build nothing**, and choose fast-track. The unchanged reliability goal fails
at month **73** (about **90.11%** demand served). This is a real required-goal
failure, rather than a substituted target or a debug ending.

## Prepare before the freeze

The imported scenario 107 arc keeps the January 2020 decision (month **37**),
February 2021 freeze (month **50**) and month **51** thaw. Winterization costs
**$90 million**. During the freeze it raises the story's gas-output factor from
**62% to 81%**; gas prices still rise to **2.8 times** baseline. Recurring cold
hazards and ordinary outages also remain active.

The inherited goal is unchanged: serve at least **99.5%** of demand in February
2021, exactly month 50. The three-month deep-freeze report covers month 49 before
the event, month 50 during it and month 51 after it. It does not substitute an
average over the whole run for that required month.

A winning preparation route for either branch on both tested seeds:

1. At the opening, finance **3,000 MW of Natural Gas Peakers** and set the rate to
   **$0.091/kWh**.
2. Before advancing, move the original Natural Gas CC up one dispatch position,
   then the original Nuclear plant up one, then the new Peaker up one. The
   resulting priority is **Natural Gas CC, Wind, Nuclear, new Peaker, Coal**.
3. At the opening of month **25**, buy a second peaker **for cash**: **1,000 MW**
   if you intend to winterize, or **1,500 MW** if you intend to keep standard
   equipment. Leave its default dispatch position.
4. At month **37**, choose **Fund winterization** or **Keep construction budget** to match
   the construction plan. Continue through month 60.

Paying for protection reduces the backup capacity needed by this route. Keeping
standard equipment saves the upfront response cost but requires a larger paid
reserve. The route deliberately buys reserve before the warning, rather than
assuming a plant ordered during the freeze can commission in time.

## Two dry years

This package keeps Lusaka's inherited **435 MW Hydro**, **16 MW Oil** and **6 MW
Solar**, including the full starting reservoir and the 65 MW mining connection.
It replaces the original arc with two declared twelve-month phases:

| Window       | Hydro inflow | Decision                      | Conservation alternative                               | Funding alternative                         |
| ------------ | -----------: | ----------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| Months 13–24 |          50% | First response, due month 12  | Pay $5 million, then $125,000/month; demand falls 10%. | Receive $5 million; demand stays unchanged. |
| Months 25–36 |          25% | Second response, due month 25 | Pay $3 million, then $125,000/month; demand falls 10%. | Receive $3 million; demand stays unchanged. |

The second answer is independent of the first: all four answer combinations are
playable and tested. Each conservation condition uses `requiresChoice` with the
option set `["conserve"]`. The first conservation expense and demand effect end
at the opening of month **25**; the second end at month **37**. The second
drought also ends at month 37. Effects are per company, while weather comes from
the shared location.

The reliability goal requires **98% demand served each month 13–36**. The
emissions goal allows **1,000,000 tonnes CO2e over months 13–48**, including
construction and purchased electricity. The reliability and profit/loss debriefs
use their declared windows and recorded monthly totals.

A winning route for every answer combination on both tested seeds:

1. At the opening, finance **200 MW Oil** and set the rate to **$0.10/kWh**.
   This is the opening public-utility rate cap, twice the inherited $0.05 rate.
2. Before the clock advances, move the original Solar plant up one dispatch
   position, then Hydro up one, then the original 16 MW Oil up one. The final
   priority is **Solar, Hydro, old Oil, new Oil**. Keeping the new diesel reserve
   below Hydro avoids paying for diesel as baseload.
3. Answer both prompts, independently choosing conservation or fuel support.
   Keep the reserve available through month 48; avoid raising demand with new
   connections or moving diesel ahead of the dam.

Conservation pays a real upfront and recurring expense to reduce the amount of
backup fuel needed. Fuel support improves cash immediately but leaves the larger
load and emissions to manage. A serialized save after the first decision and
several events, with the second prompt pending, resumes the same physics,
receipts, progress and final accounting after the installed package is updated,
removed or unavailable. The saved run carries its original version 1 rules.

## Retire coal without a bill shock

This package starts the inherited scenario 102 coal fleet in **2020** and keeps
its original sizes and ages. Static facility modifiers make Natural Gas CC
construction cost **80%** and build time **50%** of its ordinary quote; Solar
construction cost is 80%. These are multipliers, not a price of $0.80 per watt
or a six-month build time. Difficulty, the cost era and ordinary inflation still
apply. The original aging-coal story is deliberately omitted with
`officialArcs: []`.

Four required goals operate together:

- Own no Coal from month **25** through the end; a paused or unfinished Coal
  plant still counts as owned.
- Keep the recorded billed electricity rate at or below **$0.11/kWh** in every
  month **1–36**. Grants do not count as customer electricity payments.
- Keep outstanding loan principal at or below **$300 million** at every month
  end **1–36**.
- Serve at least **99.5%** of demand in each month **25–36**.

A winning route on both tested seeds:

1. At the opening, finance **400 MW Natural Gas CC**. Keep the package's
   **$0.10/kWh** rate.
2. At the opening of month **7**, buy another **200 MW Natural Gas CC for cash**.
   Confirm the order exists; a cash purchase is rejected if you cannot afford
   it.
3. At the opening of month **25**, sell **both inherited Coal plants**. In a new
   run these are facility IDs 1 and 2. Keep both replacement gas plants.
4. Continue through month 36. The fuel-mix and profit/loss reports cover only
   the post-retirement months 25–36.

Financing every replacement risks the debt limit; funding all replacement from
cash can delay commissioning. The tested route combines one loan with one later
cash purchase while preserving the full retirement, bill and supply targets.

## Verification

The checked-in suite runs the real reducer through `Simulator`, with economic
and physical invariants enabled. It covers **36 complete winning runs**: two
difficulties, two seeds, every connection/freeze branch, all four drought answer
combinations and the retirement package. It separately proves the unchanged
connection goal can fail. Dedicated reducer and two-company World tests cover
choice durability, independent company accounting and save restoration.

```sh
npm run test:once -- ModExamples.sim.test.tsx ModExamples.test.ts ModExampleDurability.test.tsx --runInBand
```

The exact paid actions are in
[`ModExampleFixtures.ts`](../../../src/testing/ModExampleFixtures.ts), and
[`ModExamples.sim.test.tsx`](../../../src/testing/ModExamples.sim.test.tsx)
checks every branch. These are reproducible examples of viable play, not a free
bot or a guarantee that an unchanged plan wins every difficulty and seed.
