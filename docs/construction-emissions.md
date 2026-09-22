# Construction emissions

Last reviewed: 2026-09-22. Primary-source audit; simulation coefficients unchanged.

The game separates construction emissions from operating emissions. Wind, solar and nuclear
have no fuel-combustion emissions during generation; storage and interties also have losses whose
emissions depend on the electricity supplying them. Hydro can emit reservoir greenhouse gases.
None of these distinctions makes their construction emissions zero.

The coefficients below are **game engineering estimates for the construction phase**: raw
material extraction, component manufacturing, transport to site, and installation. They are not
measurements of the game's individual projects or a reproduced dataset of published construction
factors. The primary sources below support accounting boundaries, broad magnitudes and technology
differences; the exact coefficients, decay rates and floors remain modeling assumptions.

Values are expressed per watt of nameplate power, or per watt-hour of capacity for storage.
They do not depend on how hard the asset is later operated. Future revisions should retain a
source-specific bill of materials or a transparent conversion before claiming a calibrated value.

## The model

One resolved coefficient per build option:

- Generators carry `constructionKgco2ePerW`
- Storage carries `constructionKgco2ePerWh`
- Interties derive theirs from the corridor's cost per watt

Storage gets only the energy term because each storage technology here has a fixed duration -- a
battery is always four hours, pumped hydro always ten. A second, power-proportional coefficient
would be unidentifiable: no choice a player can make would ever distinguish it from the first, and
carrying both would invite double counting. If duration ever becomes a player choice, power and
energy terms will need separate inventories; no universal percentage split is assumed here.

Most technologies hold their figure flat. Three do not, and they decay toward a floor rather than
by a flat annual percentage:

```
E(year) = floor + (E0 - floor) * exp(-k * max(0, year - referenceYear))
```

This shape prevents an unlimited annual percentage improvement from driving the estimate toward
zero in long games. The floors and decay rates are scenario assumptions, not experimentally
established physical minima or forecasts. Materials, manufacturing electricity and process changes
can all affect future construction intensity; these curves do not model those processes separately.

A quote resolves against the catalogue's year at purchase, so a plant keeps the embodied emissions
of the year it was actually built rather than drifting as the technology improves around it.

## Generators, kgCO2e per watt of nameplate

| Option                     | Value | Ref year |     k | Floor |
| -------------------------- | ----: | -------: | ----: | ----: |
| Coal                       |  0.32 |     2025 |     0 |     — |
| Natural Gas (simple cycle) |  0.06 |     2025 |     0 |     — |
| Oil                        |  0.15 |     2025 |     0 |     — |
| Biomass                    |  0.45 |     2025 |     0 |     — |
| Nuclear                    |  0.30 |     2025 |     0 |     — |
| Geothermal                 |  0.95 |     2025 |     0 |     — |
| Enhanced Geothermal        |  1.00 |     2025 |  0.12 |  0.38 |
| Wind                       |  0.42 |     2025 |     0 |     — |
| Offshore Wind              |  0.65 |     2025 |     0 |     — |
| Airborne Wind              |  0.20 |     2025 |     0 |     — |
| Solar                      |  0.60 |     2025 | 0.055 |  0.12 |
| Hydro                      |   2.0 |     2025 |     0 |     — |

The gas coefficient represents the game's simple-cycle plant, rather than a combined-cycle
plant. The offshore-wind coefficient represents a fixed-bottom project. Neither distinction
establishes a universal numeric multiplier: plant equipment, foundations, water depth and supply
chains need project-specific inventories. Oil and biomass are particularly weakly anchored
engineering estimates; the sources below do not directly validate their construction coefficients.

## Storage, kgCO2e per watt-hour of capacity

| Option       | Value | Ref year |     k | Floor |
| ------------ | ----: | -------: | ----: | ----: |
| Battery      | 0.080 |     2025 | 0.045 | 0.025 |
| Pumped Hydro | 0.060 |     2025 |     0 |     — |

The battery estimate is 80 kgCO2e/kWh of installed capacity, intended to include cells and the
surrounding system. Peiseler et al. report a modeled global 90% interval of **54–69 kgCO2e/kWh
for LFP cells**, with a median of 62. Their boundary does not establish the installed system's
80 kg figure: the additional allowance for housing, power electronics and installation is an
engineering estimate. Their NMC811 cell interval is 59–115 kgCO2e/kWh; it should not be treated as
a fixed chemistry multiplier. [Primary study, Figures 2–3](https://www.nature.com/articles/s41467-024-54634-y).

Pumped hydro's 60 kgCO2e/kWh is likewise an estimate, not a quoted result from Simon et al.
Their functional unit is electricity delivered over the life of storage, which is different from
installed energy capacity. Charging electricity and project configuration matter to that result;
a construction coefficient must isolate the construction inventory before converting units.
[Simon et al., 2023](https://www.nrel.gov/docs/fy23osti/81327.pdf).

## Interties

The authored corridors record what a route costs but not how long it is, so cost per watt stands in
for length and terrain:

```
kgCO2e/W = 0.08 * (costPerW / 0.56) ** 0.7 * (EXISTING ? 0.7 : 1)
```

The coefficient 0.08, exponent 0.7 and EXISTING multiplier 0.7 are game assumptions, not a
regression fitted to project observations. Cost is an imperfect substitute for route length,
terrain, conductor design and substation requirements; land and permitting costs need not track
material emissions. The damping and reuse discount express that limitation without claiming a
universal share of cost or avoided carbon.

Wei et al. provide inventories for 191 Chinese transmission projects, spanning voltage and terrain
classes. This supports the need to distinguish projects and include materials, equipment and
construction activity, but does not validate the game's international cost-to-carbon formula.
[Primary inventory and methods](https://www.nature.com/articles/s41597-020-00662-4).

The current formula yields roughly 0.05–0.13 kgCO2e/W across authored corridors. This is a
model output, not an observed uncertainty interval.

An upgrade is charged the corridor's own per-watt intensity on the watts it adds, not on the whole
line over again.

## How upgrades relate to actual projects

The game's 1.5x steps, limited count, escalating cost, construction time and technology/neighbor
ceilings are a simplified upgrade policy. DOE describes advanced reconductoring that can double
capacity on suitable lines, sometimes within 1–3 years and without new rights of way. That supports
offering an upgrade, but does not mean every corridor can repeatedly increase capacity by the
same factor. [DOE resource adequacy report, page 21](https://www.energy.gov/sites/default/files/2024-04/2024%20The%20Future%20of%20Resource%20Adequacy%20Report.pdf).

Structure condition, clearances, terminal equipment and system constraints remain important.
DOE's conductor scan explicitly notes that some projects need substation work or replacement
structures. Keeping the old rating available during construction is a game simplification, not a
promise that real construction needs no outages. [DOE advanced conductor scan, executive summary](https://www.energy.gov/sites/default/files/2024-08/Advanced%20Conductor%20Report%20December%202023.pdf).

## What is excluded, and why

**Operation.** Fuel combustion, geothermal geofluid venting, reservoir methane, transmission I2R
losses. These are the operational emissions the game already models, or deliberately does not.

Reservoir methane is operational and excluded from this construction term. Dam geometry,
materials and site conditions also vary, so excluding methane does not by itself establish a
narrow universal range for hydro construction emissions.

**Fuel supply chains.** Mining, drilling, enrichment, feedstock cultivation, fuel transport.

Nuclear fuel-chain emissions must not be presented as reactor construction emissions. Gibon and
Hahn Menacho identify enrichment, extraction technique and ore grade as influential parameters;
their simplified models retain enough parameters to explain at least 90% of modeled variation.
That is not a claim that enrichment alone explains 90% of all published estimates. The paper does
not directly establish the game's 0.30 kgCO2e/W construction coefficient.
[Primary study, Sections 4–5](https://pubs.acs.org/doi/10.1021/acs.est.3c03190).

**Operations and maintenance, including mid-life replacement.** Battery augmentation can add
material emissions after commissioning. It is excluded from this construction charge because
booking future replacement cells up front would put them in the wrong period. The game's operating
cost assumptions cover augmentation, but its emissions model does not separately accrue it.
No universal augmentation percentage is claimed here.

**Decommissioning and recycling credits.** Excluded in both directions. Note that some published
figures net out recycling credits and will therefore look lower than these for the same object.

## The carbon fee never applies

`expensesCarbonFee` is charged on local operational emissions alone. Construction emissions are
added to the headline total after that multiplication, and a regression test asserts the identity
directly on every tick.

This is a boundary of the game's accounting model: the operating carbon fee applies to local
combustion, while construction emissions come from the project's supply chain. The game does not
model a separate supply-chain carbon charge. This is not a claim that embodied emissions are
exempt from every real-world carbon-pricing scheme.

They still count towards the score, which is the point: a player who builds their way to a clean
grid should see that the building itself was not free.

## What this does to the game

Construction emissions increase the headline carbon total and affect score. They do not directly
change the cash path because the carbon fee excludes them. Their score impact depends on how much
is built, when it is built and the scenario's scoring rules; no fixed 1–3 point range is guaranteed.
They should communicate the material cost of building a clean grid without equating it to a fossil
plant's lifetime fuel combustion.

## A trap worth recording

**IPCC AR5 Annex III's "infrastructure and supply chain" column is not construction.** It bundles
the fuel supply chain, and it is the first place anyone revisiting these numbers will look.

Do not convert an aggregate lifecycle intensity into construction emissions unless the source
separates construction from fuel supply, operation and end of life. NREL's harmonization fact
sheet provides phase-separated estimates, but those are still normalized to each study's generated
electricity and operating assumptions. [NREL, 2021, Table 1](https://www.nrel.gov/docs/fy21osti/80580.pdf).

**Do not run a published gCO2e/kWh against the game's own capacity factor and lifetime.** Pairing a
fixed intensity with a longer assumed life raises the per-watt answer, which is backwards -- a
longer life should lower the intensity of the same built object. Per-megawatt bottom-up derivations
are the ones to trust; per-kWh figures work only as a cross-check, using the source's own
assumptions. The conversion, when needed, is
`kgCO2e/W = gCO2e/kWh * CF * 8760 * lifetimeYears / 1e6`.

**Enhanced geothermal is design-sensitive.** Sullivan et al. model particular hydrothermal and
EGS designs; their drilling and plant inventories are useful anchors. The game's lower EGS
coefficient and rapid future decline are optimistic engineering assumptions, not demonstrated by
that older study. A quantitative claim about modern meters drilled per MW needs a matched modern
field inventory before it can justify a revised coefficient.
[Argonne ANL/ESD/10-5, 2010](https://www1.eere.energy.gov/geothermal/pdfs/lifecycle_analysis_of_geothermal_systems_draft.pdf).

## Evidence strength and remaining gaps

The tables report the game's current coefficients without assigning statistical confidence to
unverified point estimates. In particular:

- **Hydro** is site-specific; a factor-of-two sensitivity range would be a modeling assumption,
  not a measured uncertainty bound for all projects.
- **Airborne wind** is prospective. A 2023 component-level study models future 5 MW systems and
  finds lower material use and impacts than its conventional comparison. Its functional unit,
  design and lifetime boundary do not establish a universal quarter-material rule or directly
  validate the game's 0.20 kgCO2e/W. [Primary study, Sections 2–3](https://www.mdpi.com/1996-1073/16/4/1750).
- **Coal, gas, oil and biomass** need construction-only inventories matched to the modeled plant.
  Fossil-fuel combustion and biomass feedstock emissions cannot be used as substitutes.
- **Solar and wind** have useful lifecycle inventories, but manufacturing region, technology and
  installation alter the result. The fixed estimates and solar decay curve are simplified choices.
- **Storage and transmission** have the boundary and proxy limitations described above.

## Additional primary references

These sources provide context and inventory methods, rather than individually certifying every
coefficient in the tables:

- [UNECE, Life Cycle Assessment of Electricity Generation Options, 2021](https://unece.org/sites/default/files/2021-11/LCA_final.pdf): comparative lifecycle inventories and technology boundaries.
- [IEA PVPS Task 12, 2022 fact sheet](https://iea-pvps.org/fact-sheets/fact-sheet-environmental-life-cycle-assessment-of-electricity-from-pv-systems-2022-update/): PV lifecycle scope includes manufacture through end of life, so the headline is not construction-only.
- [IEA PVPS Task 12, 2026 inventory update](https://iea-pvps.org/key-topics/t12-lci-pv-systems-2026/): updated PERC/TOPCon, CdTe and balance-of-system inventories for a future coefficient recalibration; not a validation of the existing solar decay curve.
