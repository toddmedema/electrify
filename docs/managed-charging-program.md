# Managed EV charging

The utility offers recurring charging credits for control of compatible passenger-car
charging. Enrollment builds over 12 months to half of eligible vehicles. This program
shifts existing electricity consumption; it does not subsidize EV purchases or electrify
rail, shipping, buses, trucks, or the entire transport sector.

## Evidence and limits

- [UK Power Networks' Shift trial](https://smarter.energynetworks.org/projects/nia_ukpn0045/)
  found strong evening peak reductions among participating cars, sufficient plugged-in
  time to meet mobility needs, and better reliability with recurring incentives. Drivers
  chose smart charging for 85% of sessions, with overrides important for acceptance.
  The trial also observed a new overnight peak; these are participating-car results,
  not whole-grid demand reductions.
- [The UK smart charging action plan](https://www.gov.uk/government/publications/electric-vehicle-smart-charging-action-plan/electric-vehicle-smart-charging-action-plan)
  estimated that up to 70% of EV drivers with off-street parking had a dedicated home
  charge point in 2023, most with some smart functionality. The
  [private charge-point regulations](https://www.gov.uk/guidance/regulations-electric-vehicle-smart-charge-points)
  required smart functionality for new private chargers from June 2022. These support
  a gradual capability curve; they do not establish universal historical compatibility.
- [IEA Global EV Outlook 2025](https://www.iea.org/reports/global-ev-outlook-2025/trends-in-electric-car-markets-2)
  puts electric passenger cars at about 4% of the worldwide fleet in 2024, versus about
  10% in China and 5% in Europe. These stock shares are much smaller than new-sales
  shares. Its [2026 update](https://www.iea.org/reports/global-ev-outlook-2026/trends-in-electric-cars)
  puts the world at about 5% and China at 13% in 2025, with Norway above one-third.
- [IEA Global EV Outlook 2016](https://www.iea.org/reports/global-ev-outlook-2016)
  provides country EV stock series through 2015. Norway's
  [official vehicle statistics](https://www.ssb.no/en/transport-og-reiseliv/statistikker/bilreg/aar)
  distinguish the fleet by fuel; its
  [2017 release reporting 2016](https://www.ssb.no/en/transport-og-reiseliv/artikler-og-publikasjoner/almost-100-000-electric-passenger-cars)
  reports nearly 100,000 battery cars against 2.7 million total cars. Early EV fleets
  were small even where new-car EV sales were growing quickly.

## Explicit game assumptions

`src/data/ElectricVehicles.ts` stores rounded fleet calibrations with linear interpolation,
country overrides for China and Norway, broad regional fallbacks, and capped long-term
adoption. The exact regional points are a compact gameplay model, not a complete national
registration dataset. North America represents the US/Canada market; Oceania represents
Australia/New Zealand; emerging markets use a deliberately lower trajectory. Unknown
locations use the world curve. Passenger cars include battery cars and plug-in hybrids,
but exclude conventional hybrids.

Modern flexible EV load is exactly zero through 2010, including 1980 scenarios. In 2015,
fleet shares are around 0.1–0.3% in most covered markets (about 2.7% in early-moving
Norway), with only 15% compatible for control. Capability rises separately to 40% in
2020, 70% in 2025, and a maximum of 90% in 2035. These capability percentages are
game assumptions. Fleet growth after observed years and especially 2035–2070 points
are scenarios, not measured history or guaranteed policy outcomes; the model stops
growing at its final point and never reaches 100%.

The existing demand model already favors overnight transport charging. Managed charging
therefore moves at most half of enrolled, compatible, non-override EV charging within
the selected four-hour peak window. It deliberately does not copy the trial's full 79%
peak reduction onto that baseline. A 15% override allowance remains fixed and predictable.

Transportation is not currently split by mode. The model estimates the eligible road
charging fraction as `0.75 × EV fleet share / (EV fleet share + 0.03)`. The 0.03
rail-equivalent denominator and 75% upper bound are conservative game calibrations,
leaving rail and other inflexible transport outside control. A separate ceiling of
0.8 cars per utility customer × fleet share × 6 kWh/day per car prevents a tiny fleet
from controlling a large authored transport load. The 6 kWh/day is a coarse average,
not a per-vehicle travel simulation; it also includes charging losses in the baseline.

Every deferred Wh returns over the six hours following the four-hour peak window,
giving each session a finite deadline no more than ten hours after window start.
Charging recovery is spread evenly instead of releasing all cars at one instant.
The queue survives midnight, monthly policy changes, and program cancellation. A
forecast owns its own copied queue. Overdue energy is returned if a caller jumps time.
There is no V2G discharge or energy saving, and no additional recovery loss because
the same charging consumption is rescheduled. Household time-of-use acts only on
Residential demand; this program acts only on Transportation, avoiding overlap.

Participation costs $72 of credits plus $18 of administration per compatible enrolled
EV-year, in real 2025 dollars. These are transparent game assumptions, not a currency
conversion of the UK trial. The policy owner applies inflation and monthly accounting.
Paid vehicle counts are also capped by the EV energy represented in the game's actual
average Transportation demand (eligible average watts divided by 250 W per EV). This
prevents incentives for real-world fleet vehicles whose consumption the game's compact
transport baseline does not contain. It does not add new demand to an inactive program.
Payments depend on eligible vehicles and enrollment, including when the selected window
has little charging to move; cancelling stops new participation costs and deferrals,
while the existing energy obligation remains.

## Verification contract

Focused helper tests require zero historical flexibility, limited 2015 impact, regional
fleet differences, bounded future adoption, an inflexible transport floor, costs tied to
enrollment, and conservation through midnight/cancellation/deadline recovery. The root
policy integration also needs save/replay, preview/live queue ownership, monthly cost,
and full simulation checks.
