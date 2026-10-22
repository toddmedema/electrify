# Wildfire intertie mission

Scenario 111 now tests preparation for losing a pivotal import route. It starts with a
completed, debt-free 40 MW Northern intertie and an intentionally import-dependent local
fleet. In January and February 2025, the northern route retains 10% of its nameplate
capacity (a 4 MW surviving-route cap); it returns to normal in March. The restriction applies in both trade directions,
before the ordinary weather rating. Upgrading the same route cannot raise this cap.
The Desert connection remains an independent alternative.

Co-op retains this authored outside connection alongside the player links, so the outage
still affects an existing import route. That connection belongs to its company; only shared
player links require a co-signed upgrade. Existing co-op saves retain their previous topology.

The severity is grounded in [CAISO's September 20, 2021 opening brief, printed page 7](https://www.caiso.com/documents/sep20-2021-openingbrief-amendedscopingmemo-ruling-phase2-reliableelectricservice-extremeweatherevents-r20-11-003.pdf#page=10).
It reports that the Bootleg fire tripped three of four lines north of Malin on July 9,
reducing Malin transfer capacity from 2,967 MW to 285 MW, approximately a 90% loss.

This mission is an authored stress exercise inspired by that mechanism. Its Los Angeles
setting, utility scale, starting portfolio, January-February timing and two-month duration
are game design assumptions. It does not claim that the historical Malin reduction lasted
two months, or reconstruct LADWP's January 2025 emergency. Existing mission dates and ID
are retained for saved runs, achievements and links.

## Player contract

Prepare replacement supply before the outage and supply at least 99.5% of demand during
the two emergency months. Buying more capacity on the affected route retains its 90%
restriction. Local generation, storage, demand programs and independent connections use
the ordinary construction and dispatch systems; there is no preparedness purchase.

The only wildfire effect is the major route restriction. The former smoke calendar,
small service-energy reductions, arbitrary generator penalties, restoration charges,
mobile backup and standing preparedness program are removed. The design omits minor
secondary effects below 10% instead of adding events or controls for them.

The representative-day engine applies the full restriction throughout each emergency
month, preserving its peak impact rather than diluting it into a small monthly average.
It does not model the chronology of a particular multiday fire or prove multiday battery
endurance.

## Verification

`WildfireIntertie.test.tsx` exercises the real forecast and owning transmission API: the
starting connection works, the route loses 90% capacity, other routes remain available,
imports and exports obey the same limit, and normal capacity returns after the outage.
The compact forecast worker transport retains the restriction. Negative or nonfinite saved limits are rejected.

`WildfireIntertieBalance.sim.test.tsx` compares neglect, affected-route upgrades and viable
preparation plans using the real reducer, across both difficulty endpoints and multiple
seeds. Existing economy tests retain their one-action Intern and ten-decision CEO plans.

Schema 5 removes retired active wildfire systems and legacy custom-event selections.
Historical results, cash, fleet, recorded actions and challenge identity are preserved.
Only forecast ticks after the saved instant are refreshed.
