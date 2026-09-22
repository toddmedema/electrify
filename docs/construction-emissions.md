# Construction emissions

Last reviewed: 2026-09-21.

Wind, solar, nuclear, hydro, storage and interties emit nothing while they run, but building them
emits a great deal. This is where those figures come from, what they deliberately leave out, and
why the carbon fee never touches them.

Every number below is the **construction phase only**: raw material extraction, component
manufacturing, transport to site, and installation. Each is expressed per watt of nameplate power,
or per watt-hour of capacity for storage, because that is the unit a built object actually has. It
does not depend on how hard the thing is later run.

## The model

One resolved coefficient per build option:

- Generators carry `constructionKgco2ePerW`
- Storage carries `constructionKgco2ePerWh`
- Interties derive theirs from the corridor's cost per watt

Storage gets only the energy term because each storage technology here has a fixed duration -- a
battery is always four hours, pumped hydro always ten. A second, power-proportional coefficient
would be unidentifiable: no choice a player can make would ever distinguish it from the first, and
carrying both would invite double counting. If duration ever becomes a player choice, the split is
roughly 88% energy / 12% power for a four-hour battery and 50/50 for ten-hour pumped hydro.

Most technologies hold their figure flat. Three do not, and they decay toward a floor rather than
by a flat annual percentage:

```
E(year) = floor + (E0 - floor) * exp(-k * (year - referenceYear))
```

A constant percentage is what this shape exists to avoid. Batteries falling 6%/yr from 0.08 reach
0.0035 kgCO2e/Wh by 2075, which is roughly the mass-specific carbon of sand and well below what
the required materials can physically emit. The floor is the part no amount of clean electricity
removes: clinker calcination is a chemical reaction rather than an energy input, primary aluminium
consumes its carbon anode, silicon is won by carbothermic reduction, and a drilling rig burns
diesel.

A quote resolves against the catalogue's year at purchase, so a plant keeps the embodied emissions
of the year it was actually built rather than drifting as the technology improves around it.

## Generators, kgCO2e per watt of nameplate

| Option                     | Value | Ref year |     k | Floor | Confidence     |
| -------------------------- | ----: | -------: | ----: | ----: | -------------- |
| Coal                       |  0.32 |     2025 |     0 |     — | med-high       |
| Natural Gas (simple cycle) |  0.06 |     2025 |     0 |     — | medium         |
| Oil                        |  0.15 |     2025 |     0 |     — | low-med        |
| Biomass                    |  0.45 |     2025 |     0 |     — | low-med        |
| Nuclear                    |  0.30 |     2025 |     0 |     — | high           |
| Geothermal                 |  0.95 |     2025 |     0 |     — | medium         |
| Enhanced Geothermal        |  1.00 |     2025 |  0.12 |  0.38 | med-low        |
| Wind                       |  0.42 |     2025 |     0 |     — | high           |
| Offshore Wind              |  0.65 |     2025 |     0 |     — | med-high       |
| Airborne Wind              |  0.20 |     2025 |     0 |     — | **low**        |
| Solar                      |  0.60 |     2025 | 0.055 |  0.12 | medium         |
| Hydro                      |   2.0 |     2025 |     0 |     — | **low, +/-2x** |

Combined-cycle gas would be 0.10. The game's gas plant is deliberately the simple-cycle fast-start
machine, which has no heat recovery steam generator, steam turbine, condenser or cooling tower --
the HRSG alone runs about 5,000 tonnes on a 2x500 MW block, and simple cycle lands near 0.6x the
combined-cycle figure per watt.

Offshore wind at 0.65 is fixed-bottom monopile, matching the reference the cost model already uses.
Floating is 1.7-2.0x that, around 1.1-1.3, if that option is ever split out.

## Storage, kgCO2e per watt-hour of capacity

| Option       | Value | Ref year |     k | Floor | Confidence |
| ------------ | ----: | -------: | ----: | ----: | ---------- |
| Battery      | 0.080 |     2025 | 0.045 | 0.025 | high       |
| Pumped Hydro | 0.060 |     2025 | 0.010 | 0.035 | medium     |

The battery figure is LFP, now the dominant grid chemistry. NMC is about 20% higher with a much
fatter upper tail, to 0.140.

Corrected, a ten-hour pumped hydro scheme and a four-hour battery have comparable embodied carbon
per watt-hour of capacity. Pumped hydro wins decisively over a lifetime -- 75 years with no
augmentation against 20 years with 30-50% cell replacement -- which is the interesting trade-off
and the reason the two figures should not be far apart.

## Interties

The authored corridors record what a route costs but not how long it is, so cost per watt stands in
for length and terrain:

```
kgCO2e/W = 0.08 * (costPerW / 0.00056) ** 0.7 * (EXISTING ? 0.7 : 1)
```

Two things about that formula are deliberate.

**The exponent is not 1.** Somewhere between a third and a half of transmission capital cost is
right of way, permitting, legal work and engineering, none of which emits much -- and that share is
exactly what grows on the expensive, contested routes. Scaling linearly with cost would pile carbon
onto precisely the corridors where the extra money bought lawyers rather than steel.

**The EXISTING discount is mild.** Reinforcing a standing corridor reuses its towers, foundations
and cleared route, which really are over half a new line's embodied emissions, and reconductoring
lands near 20-25% of new build per watt added. But the authored costs already price existing routes
about a third below new ones, so the full structural discount applied on top of that would count
the same saving twice. 0.7 on top of the cost ratio reproduces the right end figure.

This yields 0.05-0.13 kgCO2e/W across the shipped corridors, which sits between simple-cycle gas
and nuclear and about 4x below onshore wind. That ordering is the sanity check: a transmission line
is metal-heavy per kilometre but metal-light per watt, because one circuit moves gigawatts.

An upgrade is charged the corridor's own per-watt intensity on the watts it adds, not on the whole
line over again.

## What is excluded, and why

**Operation.** Fuel combustion, geothermal geofluid venting, reservoir methane, transmission I2R
losses. These are the operational emissions the game already models, or deliberately does not.

Reservoir methane is the one worth naming. It is operational, not construction, and it dominates
tropical hydro assessments -- often 95%+ of a published figure. Excluding it collapses the hydro
spread from roughly 1000x to about 3x for conventional impoundments of this size. There is
deliberately no temperate-versus-tropical split on the construction term: climate zone does not
change how much concrete a dam needs.

**Fuel supply chains.** Mining, drilling, enrichment, feedstock cultivation, fuel transport.

Nuclear benefits most from this boundary. Published full-lifecycle nuclear assessments span 1.4 to
288 gCO2e/kWh -- a 200x range -- almost entirely because of the enrichment assumption: gaseous
diffusion needs 2,500 kWh/SWU against 50 for centrifuge, and that single choice explains over 90%
of the variance. Construction alone spans about 4x, and that spread is real physical variation
rather than methodological disagreement.

**Operations and maintenance, including mid-life replacement.** The significant omission here is
**battery augmentation**, which adds 25-35% to a battery's lifetime embodied carbon at one cycle a
day. It is cells only; the power conversion system, containers and civil works are reused. It is
excluded because it is an operational stream spread over twenty years, and booking it at
construction time would put it in the wrong decade. The cost side already prices it: the battery's
annual operating cost includes augmentation for about 1.5% annual degradation.

**Decommissioning and recycling credits.** Excluded in both directions. Note that some published
figures net out recycling credits and will therefore look lower than these for the same object.

## The carbon fee never applies

`expensesCarbonFee` is charged on local operational emissions alone. Construction emissions are
added to the headline total after that multiplication, and a regression test asserts the identity
directly on every tick.

The reasoning is not merely that it would be inconvenient. A carbon price reaches what a grid burns
inside the jurisdiction levying it. Embodied emissions are mostly incurred in someone else's
factories, in another country, years before the plant produces a watt. No real carbon fee reaches
them, and pretending otherwise would teach the wrong thing about what such a scheme does.

They still count towards the score, which is the point: a player who builds their way to a clean
grid should see that the building itself was not free.

## What this does to the game

Construction emissions are worth roughly 1-3 score points on a typical run. For a fossil plant they
are invisible -- a 1 GW simple-cycle gas plant emits 0.06 Mt building and 76 Mt burning, so
construction is under a tenth of a percent of its total. For renewables they convert an exact zero
into a small non-zero.

That is the intended lesson, and it is deliberately not overstated. Embodied carbon does not rival
combustion, and the mechanic should not imply it does. Because the carbon fee excludes it and no
mission objective reads emissions, adding this changes **no cash path and no scenario outcome** --
only the score and what the charts display.

## A trap worth recording

**IPCC AR5 Annex III's "infrastructure and supply chain" column is not construction.** It bundles
the fuel supply chain, and it is the first place anyone revisiting these numbers will look.

Run coal's 9.6 gCO2e/kWh from that column through the conversion and you get 2.3 kgCO2e/W, seven
times the bottom-up figure. The tells are unmistakable once you look: the same column gives nuclear
18 gCO2e/kWh, which would imply about 8 kgCO2e/W and is really uranium mining and enrichment, and
biomass 210, which is feedstock cultivation.

Two further cautions for anyone revising these:

**Do not run a published gCO2e/kWh against the game's own capacity factor and lifetime.** Pairing a
fixed intensity with a longer assumed life raises the per-watt answer, which is backwards -- a
longer life should lower the intensity of the same built object. Per-megawatt bottom-up derivations
are the ones to trust; per-kWh figures work only as a cross-check, using the source's own
assumptions. The conversion, when needed, is
`kgCO2e/W = gCO2e/kWh * CF * 8760 * lifetimeYears / 1e6`.

**Enhanced geothermal literature describes a superseded generation.** Published medians of about
32 gCO2e/kWh imply roughly 7 kgCO2e/W, seven times the figure here. That gap is not a boundary
dispute; it is metres drilled per megawatt. Designs from around 2010 assumed 3,000-5,000 m/MW where
modern horizontal fields reach about 1,000.

## Numbers to treat with suspicion

- **Hydro** is site-specific to within a factor of two either way. Head dominates: a high-head
  scheme needs a fraction of the concrete per megawatt that a low-head one does.
- **Airborne wind** rests on a single peer-reviewed assessment of a generic, unbuilt system. The
  robust part is the direction -- it uses roughly a quarter the material of conventional wind per
  megawatt -- not the absolute value.
- **Oil and biomass** per-megawatt figures are engineering build-ups rather than published values;
  no comparable study exists at these plant sizes.
- **Coal** has the widest genuine disagreement in the set, over 4x, between process-based
  bottom-ups and input-output studies whose system boundary appears to include the mine and rail.

## Primary references

- NREL Life Cycle Assessment Harmonization Project
- IPCC AR5 WGIII Annex III, Table A.III.2 (with the caveat above)
- UNECE, _Life Cycle Assessment of Electricity Generation Options_, 2021
- Hertwich et al., _Integrated life-cycle assessment of electricity-supply scenarios_, PNAS 2015
- IEA PVPS Task 12, successive editions, for the photovoltaic time trend
- Ng et al., _Parametric Life Cycle Assessment of Nuclear Power_, ES&T 2023
- Sullivan et al., ANL/ESD/10-5, for geothermal drilling material intensity
- Song et al., _Cradle-to-grave greenhouse gas emissions from dams in the USA_, RSER 2018
- ETH Zurich, _Carbon footprint distributions of lithium-ion batteries_, Nature Communications 2024
- IVL Swedish Environmental Research Institute, Report C444, 2019
- Simon et al., _Life Cycle Assessment of Closed-Loop Pumped Storage Hydropower_, ES&T 2023
- Jorge, Hawkins & Hertwich, _LCA of electricity transmission and distribution_, Int J LCA 2012
- _A 2015 inventory of embodied carbon emissions for Chinese power transmission infrastructure
  projects_, Scientific Data 2020
