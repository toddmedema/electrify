# Home battery virtual power plant

The utility enrolls already-installed, compatible household batteries over 12 months.
Participants receive monthly payments for the power their fleet can sustain for four hours.
Turning it off stops payments and utility dispatch. Households retain their hardware and
stored energy.

## International evidence

- [AEMO's 2021 VPP demonstration report](https://www.aemo.com.au/-/media/files/initiatives/der/2021/vpp-demonstrations-knowledge-sharing-report-4.pdf)
  records eight portfolios, about 7,150 participants, and 31 MW of registered capacity.
  Batteries shifted charging toward daytime and discharge toward evening. Actual response
  varied with household priorities and contracts.
- [Green Mountain Power's program](https://greenmountainpower.com/rebates-programs/home-energy-storage/bring-your-own-device/)
  allows households to share power from eligible batteries they own. [PG&E's residential battery
  program](https://www.pge.com/en/clean-energy/battery-storage.html) offers incentives for
  customers who use their batteries to support the grid. Electrify pays for peak support
  and does not model ancillary-services markets.
- [Australia's ACCC](https://www.accc.gov.au/media-release/growing-home-battery-uptake-delivering-lower-electricity-bills-but-consumer-protections-needed)
  reported VPP participation among only 24% of solar-and-battery customers. [Germany's
  economics ministry](https://www.bmwk-energiewende.de/EWD/Redaktion/Newsletter/2016/05/Meldung/batteriespeicher-foerderprogramm.html)
  reported over 19,000 battery installations supported between May 2013 and the end of 2015.
  This supports a small early market.
- [Australia's household battery guidance](https://www.energy.gov.au/solar/financial-benefits-solar/how-solar-pays-itself-and-batteries-reduce-bills)
  describes off-peak grid charging, participation payments, and contracts that retain stored
  energy for backup. The game's reserve and payment are authored assumptions.

## Availability and balance

Offers start in 2022. In five-year runs with the same demand and weather across variants,
the 2018 and 2020 fleets eliminated less than 1% of unserved energy in Phoenix and Oslo.
Both cities showed a more useful response in 2022. With solar and combined-cycle gas at
that opening year, the VPP eliminated 3.85 GWh of unserved energy in Phoenix and 1.46 GWh
in Oslo. Utility batteries quoted at the same capital plus fixed operating budget eliminated
0.80 GWh and 0.53 GWh, respectively. These are averages over three seeded runs. The
comparison holds other decisions fixed and prices utility batteries at their modeled
quotes. Actual fuel use remains in the operating accounts. In later tested starts
the VPP continued to cut shortages in both cities. Utility storage sometimes performed
better in Oslo, where cheap charging was less available. The 2022 cutoff is a gameplay
choice based on the size of the early equipment market.

## Fleet and payments

The generic installed and compatible household share interpolates from 0.04% in 2015 to
0.3% in 2020, 2.5% in 2025, 12% in 2035, and 25% from 2050. Country factors distinguish
earlier German and Japanese markets, Australia's acceleration, and slower uptake in India
and Zambia. The curve and local factors are gameplay assumptions. These shares are capped
at 30%, and at most 25% of capable households enroll.

An enrollment cohort represents a share of starting customer equivalents, scaled to the
local equipment and opt-in shares in its enrollment year. Each enrolled system is modeled
as 5 kW and 10 kWh with a 20% household reserve. Its energy capacity fades to 70% over ten
years. Contracts exit the modeled fleet gradually over years 10–15. The terms use $45 per
sustained kW per year, paid monthly while On, with the usual cost index. A fresh system can
deliver 2 kW over four hours and earns $90 annually. Dispatch can be lower when the fleet is
partially charged.

## Dispatch and accounting

The peak window paces discharge across the time remaining in the window, subject to the
available energy above the household reserve, inverter power, and residential demand.
Charging recovers genuine rooftop surplus after household self-consumption and uses
already-produced grid surplus outside the window.

Outside the window, once native load and utility storage have been supplied, the fleet can
request additional generation. Only already-running local plants with rampable headroom
and incremental costs of at most $65/MWh before inflation provide this extra power. Dispatch
leaves headroom equal to 5% of load and cannot draw imports for the household fleet. Actual
generation and fuel costs are charged. The grid draw reduces exportable supply and does not
count as electricity sold to the battery owner.

All new enrolled capacity starts empty in the model. Conversion losses are booked at charging
with 90% round-trip efficiency. Capacity fade can also remove stored energy and records the
difference as a loss. Energy is measured in representative-day Wh, consistent with utility
storage. Financial totals use the usual game time scaling.
