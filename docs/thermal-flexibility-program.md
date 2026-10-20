# Controlled heating and hot water

The `thermal` program funds controls over 36 months and pays participating equipment a monthly
reward while dispatch is enabled. It moves electricity consumption rather than saving energy.
Legacy water-heater relays are available in historical games; connected space-heating controls
are a separate, much later technology. The installation cohorts retain their original technology.

## International evidence

- New Zealand's Electricity Authority describes lower network charges in exchange for limited
  interruptions to storage water heating. Its 2024 survey reported 160 MW of hot-water/ripple
  flexibility among thirteen respondents; it explicitly was not a complete national inventory.
  The Authority's earlier review describes more than sixty years of ripple-control experience.
  These establish the historical technology distinction, rather than a universal modern adoption
  rate. [Electricity Authority survey](https://www.ea.govt.nz/news/eye-on-electricity/how-demand-side-flexibility-can-contribute-to-security-of-supply/),
  [2022 flexibility review, section 7.3](https://www.ea.govt.nz/documents/1095/03-Demand-Side-Flexibility-in-the-Wholesale-Electricity-Market-under-100-Renewables.pdf).
- Australia's PLUS ES/AGL/UNSW trial operated approximately 18,843 households for a year. It
  shifted 45.4% of studied water-heating energy to daytime, using existing smart meters. About
  25% of initially identified controlled-load circuits had no active load, and some heat-pump
  manufacturers discouraged abrupt circuit interruption. The game therefore excludes a fifth of
  the nominal enrolled response and assumes compatible controls, rather than making all thermal
  consumption interruptible. The trial's estimated A$63 annual wholesale benefit per active
  household assumed complete spot-market exposure and excluded additional operating costs;
  it is not used as a guaranteed game saving. [Final report, pp. 3–6](https://arena.gov.au/assets/2024/11/PLUS-ES-South-Australia-Demand-Flexibility-Trial-Final-Knowledge-Sharing-Report.pdf).
- Québec's Hilo program reported approximately 60,000 participating households, 200 MW curtailed,
  and C$205 average rewards in winter 2024–25. This supports automated winter heating response;
  it does not justify applying that response to every climate or every day. [Hydro-Québec results](https://www.hydroquebec.com/residential/energy-wise/why-be-energy-wise/collective-efforts-overview/results-history.html).

Equipment ownership materially limits the applicable pool. Australia's government describes
electric storage water heaters in roughly half of households. EECA puts New Zealand hot-water
energy around 30% of household energy. Statistics Canada reports electric baseboard or radiant
heating in roughly two thirds of Québec households, whereas England's 2023–24 housing survey
reports electric main heating in 8% of homes. Nordic heat pumps also have a substantial existing
stock, although district heating limits the addressable electrical pool in some countries.
[Australia equipment guidance](https://www.energy.gov.au/households/hot-water-systems),
[EECA](https://www.eeca.govt.nz/insights/eeca-insights/hot-water-heat-pumps-in-the-home/),
[Statistics Canada](https://www.statcan.gc.ca/o1/en/plus/2717-heat-how-canadians-heat-their-home-during-winter),
[English Housing Survey](https://www.gov.uk/government/statistics/english-housing-survey-2023-to-2024-low-carbon-technologies-in-english-homes-fact-sheet/english-housing-survey-2023-to-2024-low-carbon-technologies-in-english-homes-fact-sheet),
[IEA heating market discussion](https://www.iea.org/reports/installation-of-about-600-million-heat-pumps-covering-20-of-buildings-heating-needs-required-by-2030).

## Authored assumptions and limits

The profiles in `src/data/ThermalFlexibility.ts` are broad game envelopes, not historical
city-level measurements. In particular, a share of household energy is not directly equivalent
to a share of electricity: the implemented water-heating fractions are conservative authored
fractions of non-weather residential electricity. Ownership shares size control costs and rewards
separately, avoiding a second multiplication of already aggregated water-heating demand.

Half the eligible equipment pool enrolls. Half of its native eligible load can be throttled,
with 80% availability for overrides, inactive circuits and compatibility. The utility chooses a
four-hour control window; partial fleet throttling does not mean completely shutting every
house's heating off for four hours. All removed energy recovers during the following three hours,
which can create a later peak. This is a conservative aggregate approximation, not a building
temperature or tank-temperature model. The model does not represent preheating, hygiene cycles,
day-ahead optimization, or Hilo's limited number of winter calls. Daily game dispatch and its
modest response must be assessed together rather than extrapolating Hilo's event response.

Water controls ramp from unavailable in 1950 to fully deployable in 1980. Smart heating controls
are unavailable through 2010, reach 15% deployability in 2015, 65% in 2025, and at most 90% from 2035. These are authored technology constraints, not a claim that a given percentage of houses
already owns a smart thermostat. Modern technology only applies to newly installed cohorts;
an old relay cohort never gains thermostat capabilities automatically. Equipment envelopes are
held fixed within a country; unmodeled future fuel switching does not create free equipment.

The subsidy assumptions are $200 per water controller and $350 per heating controller, with
annual participation/maintenance rewards of $36 and $72 respectively, before the game's
inflation. These real-dollar game costs are not converted quotations from the international
trials. A home with both devices receives both subscriptions. Running rewards maintain the
installed capabilities; they do not upgrade old cohorts. Off pauses installation and new
dispatch/payments, and leaves already deferred energy owed to customers.

## Integration and verification contract

Apply efficiency and TOU first. Pass only remaining native residential demand to
`shiftThermalDemand`, excluding TOU recovery, so energy already shifted is not deferred twice.
The weather share may shift only when temperature is below 18°C; air-conditioning is excluded.
Keep thermal recovery separate from tariff recovery, including for billing. Any later battery
dispatch acts on the resulting net demand.

Keep the thermal queue and its pre-tick copy in ticks/save payloads and forecast clones. Each
batch has absolute recovery minutes and unscaled representative-day Wh. It survives changes to
tier, dispatch hour, installed adoption and month. Recover it even if the current program has no
eligible equipment. The helper copies its inputs and conserves native demand energy plus queued
Wh at both fine and hourly resolution; the central simulation applies the usual calendar energy
scaling once. Focused tests also cover cohort years, cooling exclusion, reduced native load,
window changes, malformed imported debt and overdue debt repayment.
