# Electrify: your first grid decisions

Your job is to keep the lights on, pay the bills, and decide how much pollution your grid produces. Start with those three goals. The game handles plant startup decisions, loan calculations, and reservoir water releases for you.

## 1. Match electricity to when people need it

Look at demand across the day. Solar helps during daylight. Wind depends on the weather. Controllable generators and stored energy can fill gaps. A low average cost is useful only if your grid can also supply the difficult hours.

**MW is power:** how much a plant or battery can deliver at once.

**MWh is energy:** how much it produces or stores over time.

A 20 MW battery holding 80 MWh can supply 20 MW for about four hours when full. It cannot supply 80 MW just because it holds 80 MWh.

## 2. Batteries move electricity; they do not make it

A battery needs electricity to charge. Some is lost in the process. At 80% efficiency, 10 MWh taken from the grid leaves 8 MWh to use later, before any further standing losses. That charging electricity cannot also power customers or be sold to a neighboring grid.

Use storage to move a daytime surplus into a later shortage. Check both its power and its duration.

## 3. Build before the shortage arrives

A new plant may take months or years to finish. Check the forecast before your existing supply falls short. Slow plants can provide steady power; quick backup can help when demand rises or renewable output falls. You do not need to schedule every startup yourself.

Forecasts show the game's assumptions. They are not promises about real future weather or prices.

Reserve is extra capacity that could help within 15 minutes, after allowing for plant ramps, water and stored energy. It can also include stopping charging or redirecting exports. It is not electricity that must be generated just to sit unused. A low-reserve warning is a cue to investigate, not a real-world reliability standard.

Hydro's main lesson is simple: rain and snow refill the reservoir; generation drains it. Water releases happen automatically. The game also chooses a broad heating/cooling demand pattern for each location. You do not need to calculate watershed or building coefficients.

## 4. Compare the bill, not just the purchase price

A cheap plant can be expensive to run. Compare its construction cost, fuel and operating costs, and any carbon fee. The purchase review shows the down payment, monthly loan payment and estimated upkeep. Loan payments begin during construction; leave enough cash for bills before the project earns money. Lifetime cost is an estimate and excludes loan interest.

You do not need to reproduce the bank's formula. Check whether you can afford both construction and the ongoing payments.

In Fuel Prices, compare possible costs in five years under slower, baseline and faster price growth. The comparison keeps this month's fuel use fixed and multiplies its bill by 12. These examples have no assigned probabilities and do not change your game or existing loans.

## 5. Track emissions alongside reliability and money

Burning fuel releases greenhouse gases. Local plants pay any scenario carbon fee. Purchased electricity also adds estimated emissions to the total and score, shown separately in Insights; Interties explains its fixed neighboring-grid assumptions. Imports have their wholesale bill rather than an extra local carbon charge. Biomass counts its combustion emissions without assuming regrowth offsets them. A plant with no modeled operating emissions still has impacts from materials, construction and land use; the game does not calculate all of them.

Climate change depends on worldwide emissions over time. Your utility contributes to that problem, but its emissions do not directly set the next month's local weather in the game. Weather and scenario emergencies still affect the power system.

Interties buy backup during shortages and sell surplus after demand and charging. Line and neighbor limits mean imports are not guaranteed. Charging electricity cannot also be sold.

## 6. Interpret the game's limits and objectives

Sites mean projects available in this game; zero sites is not proof a resource is physically impossible. Accounting life describes depreciation and cost estimates, not an automatic retirement date. Older plants can keep running with lower output or higher upkeep.

Customer response takes time: low prices and reliable service help attract customers, while whole-customer displays may hide small gradual changes. Check profits before setting a large discount.

Open Victory conditions to check your scenario's required reliability, retention and meaningful decisions. A high score cannot waive those objectives. Regular scenarios end early if cash is negative at a month-end check, or demand served stays below 90% for three consecutive completed months. Compare reliability, expenses and emissions separately: score weights and decision counts are teaching goals, not regulatory standards.

## A useful first experiment

Pause, find an hour when demand nearly exceeds supply, and choose one way to help: add controllable generation, add storage backed by a surplus, or use an available intertie to buy backup. Compare the forecast and expected costs before committing. Then watch what happens and explain the tradeoff in one sentence.

The calendar is compressed: one simulated day represents a month. This makes a long game playable, but a four-hour battery is still a four-hour battery. Do not read one representative day's success as proof that a real grid could survive every storm or several windless days.

Try Deep Freeze and Heatwave + Drought to compare choices under different authored emergencies. They use the same representative-day shortcut; neither is a consecutive-day storage adequacy study.
