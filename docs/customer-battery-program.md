# Customer batteries and virtual power plants

The program funds household batteries tied to a virtual power plant agreement over 48 months.
Only households signing up receive a rebate. On enables the funded fleet's access agreement
and recurring payments. Off pauses new rebates and grid access; installed
hardware and its remaining energy survive. Old cohorts continue to degrade and retire.

## International evidence

- [AEMO's 2021 VPP demonstration report](https://www.aemo.com.au/-/media/files/initiatives/der/2021/vpp-demonstrations-knowledge-sharing-report-4.pdf),
  pp. 4-7, records eight portfolios, about 7,150 participating consumers and 31 MW of registered
  capacity. Batteries shifted charging toward daytime and discharge toward evening. Actual
  response varied with household priorities and contracts. Frequency-control services were
  demonstrated, but Electrify awards no ancillary-service revenue because it has no such market.
- [Australia's ACCC, July 2026](https://www.accc.gov.au/media-release/growing-home-battery-uptake-delivering-lower-electricity-bills-but-consumer-protections-needed)
  found VPP participation among only 24% of solar-and-battery customers. Observed household
  bill differences also reflect owning solar and storage; they are not the causal return on a
  battery subsidy. The model therefore limits the fundable pool to households willing to
  enroll; it pays no rebates for non-participating systems.
- [Germany's economics ministry, March 2016](https://www.bmwk-energiewende.de/EWD/Redaktion/Newsletter/2016/05/Meldung/batteriespeicher-foerderprogramm.html)
  reports more than 19,000 battery installations supported since May 2013, roughly two thirds
  of Germany's installed PV-battery systems at the end of 2015. This supports a tiny early
  market, not a mature VPP in 1980 or mass adoption in 2015.
- [Australia's Clean Energy Regulator, September 2025](https://cer.gov.au/news-and-media/news/2025/september/solar-battery-installations-rise)
  reports 43,517 installations under its new rebate since July 2025. That demonstrates rapid
  expansion when equipment, installers and incentives are available; it does not establish
  universal household eligibility or enrollment.
- [IRENA's residential storage cost summary](https://www.irena.org/Energy-Transition/Technology/Energy-storage-costs)
  gives German residential system costs of US$776/kWh in 2020, 71% below 2014. Those figures
  imply approximately US$2,676/kWh in 2014. [CSIRO's GenCost 2024-25 consultation report](https://www.csiro.au/-/media/Energy/GenCost/GenCost2024-25ConsultDraft_20241205.pdf),
  p. 51, estimates A$13,500 installed for a 5 kW/10 kWh household system. The game uses a
  rounded US$900/kWh at A$1 = US$0.667. These observations describe different markets and
  years; the interpolation is a gameplay approximation, not a global measured price series.
- [Australia's Cheaper Home Batteries Program](https://www.dcceew.gov.au/energy/programs/cheaper-home-batteries)
  provides approximately a 30% upfront discount. Its [battery guidance](https://www.energy.gov.au/solar/get-know-solar-technology/batteries)
  requires VPP capability for on-grid systems. Capability does not mean the owner actually
  enrolls. Electrify uses a 30% utility rebate conditional on a VPP agreement, with only up to
  25% of the addressable hardware market opting into that agreement.
- [Tesla's Powerwall specification](https://energylibrary.tesla.com/docs/Public/EnergyStorage/Powerwall/2/InstallManual/BackupGateway/2/en-us/GUID-05D2F038-D8E2-45AF-9F8C-7A3076858433.html)
  specifies 90% round-trip efficiency. [Tesla's 2018 annual report](https://ir.tesla.com/_flysystem/s3/sec/000156459019003165/tsla-10k_20181231.html)
  describes a 70% or 80% retention warranty after ten years, depending on region. The game
  books all round-trip conversion loss at charging and uses a conservative 70% energy-retention
  trajectory; it does not assert that every battery physically degrades at the warranty floor.
- [Australia's household battery guidance](https://www.energy.gov.au/solar/financial-benefits-solar/how-solar-pays-itself-and-batteries-reduce-bills)
  describes off-peak grid charging, participation payments and contracts that retain energy
  for backup. These establish the mechanisms; the game's 20% reserve and US$60 annual
  compensation are authored parameters rather than universal contract terms.

## Explicit game assumptions

The hardware addressable share is a potential installation pool, rather than a claim about
existing national ownership. The generic curve is 0 before 2013, 0.01% in 2013, 0.04%
in 2015, 0.3% in 2020, 2.5% in 2025, 12% in 2035 and 25% in 2050. It is linearly interpolated
and held flat after 2050. Country readiness multipliers distinguish Germany's earlier market,
Australia's later acceleration, Japan's established market and slower uptake in India and
Zambia. Regional fallbacks cover unlisted countries. Every location is capped at 30% even in
distant-future custom games. These multipliers and future shares are authored assumptions,
not forecasts taken from the cited reports.

Funded households equal starting customer equivalents times rollout progress times the
installation year's hardware addressable share times that year's VPP opt-in share. This same
household count determines both capital rebates and physical power/energy. All surviving
funded systems are enrolled; their grid access is enabled while On. Non-enrolled battery
owners are outside this program and receive no rebate or modeled storage benefit.

Each funded installation cohort freezes both eligibility shares at its installation year.
Later hardware adoption or VPP participation growth never enlarges an existing cohort, raises
its dispatchable fraction or creates hardware for free.
The 48-month progress counter describes completion of this project, not universal ownership.
The model uses 5 kW/10 kWh systems in every era to avoid inventing uncalibrated technology
variants; the tiny early eligible pool and high early prices constrain historical deployment.
There is no retrofit of old lead-acid backup systems into this modern connected-battery program.
VPP opt-in begins at 2.5% of the addressable hardware pool in 2016 and rises to a 25% ceiling
in 2021. Earlier household batteries existed, but this tied VPP rebate program is unavailable
before 2016. There is no later automatic enrollment of historical cohorts. New funded systems
start empty; increasing the eligible pool affects only subsequent paid installations.

Enrollment payments are US$60 per participating household per year, an explicit conservative
game assumption. The utility pays the rebate only on installation, then ongoing compensation
only while its access agreement is On. Central policy accounting applies the game's inflation
index. Customers fund the remaining installed hardware cost. There are no invented battery
generation revenues, export credits or market-service payments.

Energy capacity falls linearly to 70% of nameplate over ten years. Retirement is spread over
years 10-15; power falls with retiring systems. These are fleet-aging assumptions, rather than
a claim that warranties prescribe actual equipment life. A 20% reserve remains unavailable to
utility dispatch. Aggregate storage contains only the funded fleet's energy. Non-enrolled
hardware is neither subsidized nor counted; household reserve energy never becomes an extra
supply source in this simulation.

## Energy and integration contracts

New installations start empty. The pure dispatch helper takes the previous tick's stored Wh,
the surviving fleet and explicitly supplied power. It can recover rooftop surplus only after
ordinary household self-consumption; it cannot use the same rooftop electricity twice.
It can also charge from actual grid surplus after generator dispatch and before export
clearing. It cannot call spare generator _capacity_ supplied electricity. Grid charging reduces
exportable surplus and is excluded from retail sales. Peak discharge is limited to customer
need, enrolled power and energy above the household reserve.

Off preserves remaining energy while disabling both charge and discharge. Capacity loss
clips any energy that no longer fits, with the removed amount reported as loss. Conversion
loss is also explicit. Tick energy uses the same representative-day units as utility storage;
time compression affects financial accounting, not stored energy. Pre-dispatch discharge and
post-dispatch charging must pass the updated energy forward and retain start-of-tick state
when rebuilding a forecast, saving or resuming a run.

The helper suite asserts historical limits, bounded future eligibility, country differences,
cohort immutability, aging, enrollment, empty rollout, reserve protection, power/headroom limits,
Off behavior and full-cycle conservation. The integrated reducer must additionally demonstrate
that grid charging changes actual exported surplus, PV recovery never duplicates self-consumption,
and save/reforecast/resume preserve battery state.
