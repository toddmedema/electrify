# Permanent winterization

Winterization is a capital improvement to a particular plant. Building it in or
retrofitting it later records permanent protection on that facility. The Deep
Freeze bulk offer purchases the remaining work on the current fleet; it does not
create a scenario-wide protection flag or cover unlimited future construction.
There is no separate ongoing winterization program.

## Cost basis

Use the following targeted protection allowances, expressed in **2020 US dollars**
and scaled to the capacity being protected:

| Technology                 | Retrofit allowance per MW | Build-in allowance per MW |
| -------------------------- | ------------------------: | ------------------------: |
| Natural gas, coal, nuclear |                    $3,000 |                    $2,000 |
| Wind                       |                   $62,000 |             $62,000 / 1.5 |

The build-in allowance is the retrofit allowance divided by the game's existing
1.5 retrofit premium. That premium represents returning crews and work around
finished equipment. It is a gameplay assumption, not an observed universal cost
ratio. Quote-time inflation uses the ordinary game cost system. These values are
targeted incremental protection allowances, not a full redesign of an unprotected
plant for an arbitrarily severe climate.

### Thermal plants

[Vistra's 2022 CDP response, PDF page 10](https://vistracorp.com/documents/sustainability/reporting-year/2021/2022%20VST%20CDP%20Response%20Final.pdf#page=10)
reports approximately $50–60 million for enhanced fleet winterization following
Winter Storm Uri. Its [2020 Form 10-K, printed page 5](https://investor.vistracorp.com/image/2020-10-K.pdf#page=12)
lists 17,623 MW of ERCOT generation: 11,293 MW gas, 3,850 MW coal, 2,300 MW
nuclear, and 180 MW solar/battery.

Assigning the full $55 million midpoint to that Texas capacity yields about
$3,121/MW. Applying the existing research memo's 0.95513 conversion to 2020
dollars yields $2,981/MW, rounded to **$3,000/MW**. Assigning the entire expense
to Texas is conservative compared with spreading it over Vistra's larger fleet.
The disclosure does not separate expenditure by technology or region. Applying
the mixed-fleet rate individually to gas, coal, and nuclear is an explicit
transfer assumption, especially uncertain for nuclear; it is not a technology-
specific supplier quote.

As a scope check, the [FERC/NERC 2011 report, printed pages 179–180](https://www.ferc.gov/sites/default/files/2020-05/ReportontheSouthwestColdWeatherEventfromFebruary2011Report.pdf#page=187)
estimates $50,000–$500,000 per conventional gas or combined-cycle unit for basic
insulation and heat-tracing upgrades, depending on existing condition and design.
Larger component changes can cost more. This supports distinguishing targeted
protection from an assumed percentage of a whole new power station's value.

### Wind

[Gruber et al.'s original 2021 preprint, Appendix A.8](https://arxiv.org/pdf/2105.05148#page=25)
explicitly notes limited available cost evidence. It uses a 5% wind investment
adder, or $65 million/GW, based on an industry/media estimate. Converting with
0.95513 gives about $62,083/MW; the game rounds to **$62,000/MW**. This is a
research-model allowance, not an observed retrofit invoice. The same appendix's
10% gas and coal capital adders are assumptions for more comprehensive scope;
they are not evidence that a targeted retrofit must cost 10% of replacement.

[Natural Resources Canada](https://natural-resources.canada.ca/energy-sources/renewable-energy/wind-energy-cold-climates)
distinguishes component-heating cold-weather packages from rotor de-icing and
anti-icing measures. Its discussion supports the mechanism and the existence of
cold-climate equipment, without establishing this price or a universal efficacy.

## Protection and residual risk

The existing Deep Freeze loss multipliers remain the unprotected stress case.
Installed protection halves a facility's output loss, not its output:

| Fuel        | Unprotected loss | Protected loss |
| ----------- | ---------------: | -------------: |
| Natural gas |              38% |            19% |
| Coal        |              27% |          13.5% |
| Nuclear     |              23% |          11.5% |
| Wind        |              56% |            28% |

The exact 50% reduction is a transparent simulation abstraction. The cited
sources do not establish a uniform protection factor across technologies.
It preserves residual equipment, icing, and supply vulnerabilities rather than
promising immunity. Temperature ratings and any generic cold-hazard behavior
must likewise be treated as the game's simplified model, not engineering design
certification for these technologies.

The narrow implementation retains the generic gas cold-hazard model. Additional
coal, nuclear, and wind packages should be offered when an authored freeze arc
actually penalizes that technology and consumes its installed protection,
including an imported Deep Freeze arc. This avoids selling inert upgrades in
games whose ordinary weather hazards never derate those technologies. Persistent
equipment does not require every technology to be offered in every scenario.

Reusing gas's standard -8 °C threshold for all technologies is not supported by
the research. Gruber's Texas outage model estimates different onset temperatures:
-8.8 °C for gas, -10.2 °C for coal, and -1.2 °C / -3.1 °C for northern/southern
wind. Those are fitted regional outage observations, not universal equipment
ratings; the study does not provide a nuclear threshold. Wind icing also depends
on conditions beyond temperature. A broader generic multi-technology hazard model
would need its own calibrated exposure and balance work.

Plant protection leaves the scenario's heating-demand and regional gas-price
shocks in place. [FERC's November 2021 final-report announcement](https://ferc.gov/news-events/news/final-report-february-2021-freeze-underscores-winterization-recommendations)
separates freezing issues from fuel-supply issues as major outage causes. Protecting
a power station's instruments does not also protect upstream wells and pipelines.

## Fleet pricing and scheduling

The authored Deep Freeze portfolio has 2,627 MW thermal and 1,200 MW wind. At the
2020 retrofit allowances its arithmetic allowance is **$82.281 million**. The
ordinary facility quotation rounds its authored 1,497 MW gas row to **1,500 MW**
when creating the game, so the actual initial fleet quote in January 2020 is
**$82.29 million**: $7.89 million thermal and $74.4 million wind. Protecting either
group beforehand removes its corresponding amount from the remaining quote.
A completed, unprotected 100 MW thermal addition adds $300,000. An unfinished
plant is excluded until it can receive an individual retrofit after commissioning.

The bulk offer uses the same outstanding work and prices as the individual
upgrade API, excludes existing protection and already purchased work, and discloses
its completion schedule and temporary output reduction. It must not charge twice
or protect later unprotected construction.

Winterization installation lasts one game month with **90% availability** during
the work. This represents staging crews across the units within a resource row;
it applies to individual and bulk winterization alike. Both the one-month duration
and the 10% temporary loss are explicit gameplay assumptions, not measured universal
installation requirements. Other retrofit types retain their own existing lifecycle.
The initial all-offline interpretation of the ordinary retrofit lifecycle would
remove the entire four-row starting fleet during a simultaneous bulk installation;
that rejected execution model motivated the selected staged-work abstraction.

[CPS Energy's December 2021 update](https://newsroom.cpsenergy.com/update-on-planned-outages-to-prepare-for-winter-weather/)
reports changing outage schedules to protect winter and summer peak months,
finishing preparedness maintenance in December, and $2 million of additional
weatherization after nearly $20 million of earlier improvements. This supports
planned work and durable investment. It does not establish a universal one-month
installation or a 10% temporary output reduction.

The starting fleet represents Austin Energy resource entitlements, including
contracted and co-owned resources. A retrofit on an aggregate resource row can
therefore represent work and supplier coordination across that entitlement;
it is not a claim that the utility owns every machine represented by the row.
See the [existing scenario-choice research](../src/testing/SCENARIO_CHOICE_RESEARCH.md)
for that portfolio's provenance.

## Verification implications

The same installed facility must receive the same freeze protection after an
individual upgrade, bulk purchase, save/import and forecast. Already
protected assets must reduce the bulk quote, and newly commissioned unprotected
assets must remain exposed. Pending work must not receive protection before
completion. A fully protected fleet should offer a zero-work acknowledgement
rather than another paid purchase.

Balance evidence should compare neglect, selective protection, a fully protected
smaller fleet, and extra unprotected firm capacity. Paying for protection should
remain an investment that can substitute for capacity; it need not have the same
final cash as every alternative. Use the real reducer and seeded scenario suites.

## Measured Deep Freeze impact

A temporary research suite ran the real reducer and existing simulator, with
seed **268107**, a constant **$0.091/kWh** player tariff, and no demand programs,
imports, dispatch changes, or other operating actions. Individual thermal
retrofits and the bulk offer were purchased in January 2020. All initial builds
were financed at the opening. The small build is 100 MW on Intern and 300 MW on
CEO; the capacity alternative is 900 MW on both. These are sampled plans, not a
claim about every possible strategy or tariff.

| Plan                             | Retrofit cost, Intern / CEO | Freeze demand served, Intern | Freeze demand served, CEO |
| -------------------------------- | --------------------------: | ---------------------------: | ------------------------: |
| No protection or new capacity    |                     $0 / $0 |             89.482% — failed |          81.094% — failed |
| Existing thermal protection      |             $7.89M / $7.89M |             99.116% — failed |          96.963% — failed |
| Existing fleet bulk retrofit     |           $82.29M / $82.29M |             99.489% — failed |          98.415% — failed |
| 900 MW, unprotected              |                     $0 / $0 |         100.000% — completed |       99.609% — completed |
| Small build + thermal protection |             $8.19M / $7.89M |          99.620% — completed |          99.308% — failed |
| Small build + bulk retrofit      |           $82.59M / $82.29M |          99.990% — completed |       99.941% — completed |

The required freeze demand-served share is 99.5%. All failed plans ended at
month 50 because of that physical objective; completed plans reached month 84.
All twelve runs recorded zero invariant violations. Every plan served 100% of
January 2020 demand, so the staged installation did not introduce an installation-
month shortage in these samples. That is not a guarantee for an already stressed
or smaller fleet.

The initial 100 MW Intern plant costs $56.718M to build; the 300 MW CEO plant
costs $214.846M. The 900 MW alternative costs $345.476M on Intern and $575.794M on
CEO. Those difficulty-sensitive construction quotes are separate from the
capacity-based retrofit allowances. Financing interest and ordinary operations
also affect total strategy cost.

The 300 MW CEO plant is still under construction when the bulk offer appears.
It is correctly excluded from both the payment and protection. The 100 MW Intern
plant has commissioned, so its $300,000 retrofit is included. Later unprotected
capacity therefore does not acquire protection from a recorded bulk response.

Final cash for the small-build bulk strategy was $7,024.223M Intern and
$6,280.768M CEO, compared with $6,870.326M and $6,108.328M for the unprotected
900 MW alternative. Compare these completed runs at the same horizon; cash at
month-50 failure is not comparable with month-84 ending cash. Selective thermal
protection is intentionally inexpensive and can be useful without buying the
wind work. Full protection alone is still not sufficient in these sampled plans.

The first measurement pass exposed a repeated-resolution defect: protected and
unprotected cohorts had identical served demand because the native cold-output
map was discarded on a second conversion. After the owning conversion became
idempotent and a regression check demonstrated the failure and fix, the same
plans produced the differing results above. The temporary research suite was
removed; retained behavior and balance suites own ongoing regression coverage.
