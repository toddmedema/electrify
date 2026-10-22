# Wildfire model research and proposed replacement

Research date: October 21, 2026. The implementation below replaces the original
arbitrary generator restrictions. The later architecture sections describe future work.

## Implemented model and confidence limits

Recurring events now represent **heavy wildfire smoke reducing solar irradiance**.
They do not randomly select generating plants, disconnect customers, create repair
bills, or use temperature/wind anomalies as a fire probability. The historical
January 2025 LADWP emergency remains a separate authored distribution-restoration
case. Its costs and local backup are described in the scenario's evidence.

For LA and SF, [WildfireSmokeHistory.json](../src/data/WildfireSmokeHistory.json)
contains NOAA HMS daily plume detections at the canonical city coordinates from
2017 through 2025. Every source archive has a URL, byte length, and SHA-256. A
seeded draw selects one complete source year per run calendar year, reused for
every month of that year. This annual bootstrap preserves detected seasonality,
clustering across adjacent months, and years without heavy detections. It replaces
the authored annual incident rate, monthly probability weights, six-month cooldown,
and severity/facility lotteries. The registered wildfire random stream is unchanged.
[NOAA annual smoke archives](https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/Shapefile/Annual_Bundles/).

Only the recorded **heavy** density class currently produces an effect. The
calendar retains light, medium, and unavailable observations separately. A date
without a city plume is labeled “not detected,” without claiming clear air; dates
with no polygons anywhere in the annual archive are `?`. NOAA warns that clouds,
sensor changes, and archive gaps prevent this from being an unbiased physical
smoke-frequency estimate. The model resamples recorded detections, not actual
ignition or electrical-outage probabilities. No city exposure is inferred for
other/custom coordinates or for remote generation sites.
[NOAA HMS product guidance and limitations](https://www.ospo.noaa.gov/products/land/hms.html).

Severity uses a separate regional reference: NREL Figure 18 gives five consecutive
modeled GHI losses on September 10-14, 2020. Their equal-day means are approximately
**17.4% for the Greater Bay Area** and **16.2% for metropolitan Los Angeles**, based
on source labels rounded to whole percentages. These are clear-sky irradiance
comparisons against a no-wildfire counterfactual during **10 a.m.-6 p.m. PDT**,
not individual-plant measurements or a conversion from HMS density to irradiance.
The source episode coincides with heavy HMS detections at both sampled city points.
[NREL/TP-5D00-86640, Figure 18, printed page 28](https://www.nlr.gov/docs/fy23osti/86640.pdf#page=38).

Applying that mean to every recorded heavy day is an explicit, limited transfer
assumption. The nine-year occurrence sample does not validate a nine-year loss
distribution. Light/medium smoke effects, source variability within heavy plumes,
and losses outside the reference's sampling hours remain uncalibrated. They are
omitted rather than assigned invented coefficients.

The current representative-day engine uses a uniform **365/12-day (730-hour)
month**. The daytime irradiance loss is the regional reference multiplied by
`heavySmokeDays / (365/12)`, capped at the reference if all represented days are
affected. It applies to hourly bins **10 through 17**, with hour 18 outside the
window. The existing solar calculation then determines output. For example, LA's
source September 2020 has 11 heavy detections: the daytime monthly adjustment is
about **5.86%**. Across that source year, LA has 13 heavy detections; SF has 29,
including 15 in September. Many other sampled years have no heavy detections.
These are model inputs derived from the archive, not measured PV losses.

This monthly adjustment keeps a short episode from becoming an entire month at
the full severe-day penalty. It does **not** reproduce chronological smoke peaks,
multiday battery endurance, or the exact monthly energy of a fleet with varying
daily cloud conditions. A future full chronological model should replace that
approximation before making those claims.

The importer uses Python 3's standard library, caches annual archives outside the
repository, and retains unavailable dates. Regenerate and verify from the repo root:

```text
py scripts/research-wildfire-smoke.py
npx prettier --write src/data/WildfireSmokeHistory.json
py scripts/research-wildfire-smoke.test.py
```

The importer was cross-checked against an independent pyshp/Shapely extraction for
all 6,574 city/date entries. Focused tests cover holes, boundaries, leap days,
maximum density, unknown observations, malformed inputs, annual source-year
selection, quiet years, daytime-only effects, and increasing attenuation without
increasing availability. See [wildfire-calibration-evidence.md](wildfire-calibration-evidence.md)
for exact daily references, source tables, and regeneration details.

## Future mechanism-based architecture

Replace the random selection of generators and common output multiplier with separate models for customer disconnections, transmission constraints, smoke, and physical damage. Fuel should determine a technology's response to a particular mechanism. Geography and electrical connections should determine exposure. The strongest quantitative evidence supports solar losses from smoke and customer outages measured in hours; it does not establish a common wildfire output limit for gas, hydro, nuclear, wind, and other generation.

The smallest defensible replacement would remove the generic generator penalty, retain explicitly modeled delivery outages, and add smoke attenuation to solar irradiance. Plant damage would require an exposed site or connection and a separate recovery process. That is a recommended modeling boundary, not a claim that unmodeled equipment has zero wildfire risk.

## What the evidence supports

### Customer disconnections and utility policy

Public Safety Power Shutoffs (PSPS) prevent electrical equipment from starting fires during dangerous conditions. A fire does not have to ignite for a shutoff to occur. Conversely, a wildfire can damage equipment or require emergency isolation without being a preventive PSPS event. PG&E identifies dry vegetation, low humidity, wind, and conditions near power lines as decision inputs, and describes outage durations of hours to days. [PG&E PSPS explanation](https://www.pge.com/en/outages-and-safety/safety/community-wildfire-safety-program/public-safety-power-shutoffs.html).

Actual duration is available at circuit level. PG&E's October 17–20, 2024 report records Bucks Creek 1103 de-energized at 19:55 on October 18 and fully restored at 16:53 on October 19: **20 hours 58 minutes**, calculated from its timestamps. Its reported **5.2-hour average restoration time** starts after the weather all-clear; it is not the total outage duration. [PG&E post-event report, summary and Appendix B, Table B-1](https://www.pge.com/assets/pge/docs/outages-and-safety/outage-preparedness-and-support/10-17-2024-psps-post-event-report-amended.pdf).

Utility and year matter. LADWP's June 2025 plan reported that it had neither developed preventive shutoff protocols nor previously conducted preventive shutoffs. [LADWP 2025 plan, context table, printed page 5](https://www.ladwp.com/sites/default/files/2025-07/LADWP%202025%20Wildfire%20Mitigation%20Plan.pdf#page=9). The newer document linked as its 2026 plan, internally labeled the September 2026 2027–2028 WMP, still describes proactive shutoffs as under evaluation and distinguishes them from incident-based isolation. This is evidence against transferring PG&E's preventive-shutoff practice unchanged into a historical LADWP scenario. [LADWP newer plan, sections 7.2.6.1–7.2.6.4](https://www.ladwp.com/sites/default/files/2026-10/2026%20LADWP%20Wildfire%20Mitigation%20Plan%20ADr3_0.pdf#page=92).

PG&E's revised 2024 report also shows why a universal six-month cooldown is inappropriate: it records separate events in early July, late July, September/October, October, November, and December. Its 2022 page reports no customers de-energized for PSPS that year. Neither a fixed annual incident rate nor the same event severity every year follows from this history. [PG&E revised 2024 post-season report](https://www.pge.com/assets/pge/docs/outages-and-safety/outage-preparedness-and-support/2024-post-season-report-1-narrative.pdf), [PG&E reports archive](https://www.pge.com/en/outages-and-safety/safety/community-wildfire-safety-program/public-safety-power-shutoffs.html).

### Smoke and solar output

The most defensible fuel-specific generation effect is smoke reducing sunlight. The magnitude depends on smoke optical properties, location, and time.

| Evidence                                     | Quantity and comparison                                                                                                                                                                                                                                                                | Appropriate use                                                                                                                                                                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NCAR's September 7–16, 2020 California study | Heavy-smoke days had approximately **10–30% less solar production during noon–4 p.m.** than the corresponding days in prior years; days with smoke dispersed had losses below 7%.                                                                                                      | A severe episode's hourly loss envelope, with the study's comparison limitations. It is not a universal monthly derate. [NCAR study explanation](https://news.ucar.edu/132875/california-wildfire-smoke-dimmed-solar-energy-2020). |
| NREL's June 2023 modeling study              | Its 2020 smoke scenario applied to a modeled 2024 PV fleet reduced monthly PV generation by **up to 7.7%**, with the largest loss in September.                                                                                                                                        | A monthly energy benchmark for that scenario and fleet. These are model results, not measured 2024 production. [NREL report, printed page 43](https://www.nlr.gov/docs/fy23osti/86640.pdf#page=53).                                |
| Corwin et al., published January 2025        | Local thick smoke can strongly reduce solar resources, while transported smoke's mean effect on global horizontal irradiance across the contiguous US was below 5%, even in an extreme season. Direct-normal irradiance is more sensitive than the irradiance relevant to ordinary PV. | Preserve spatial and temporal differences. Do not apply a direct-beam loss or a worst-site loss to every PV installation. [Nature Communications paper](https://www.nature.com/articles/s41467-024-54163-8).                       |

EIA's September 2020 account provides an observational cross-check, but its nearly 30% July-to-September generation comparison includes seasonal differences. It should not become a smoke coefficient. [EIA September 30, 2020 analysis](https://www.eia.gov/todayinenergy/detail.php?id=45336).

For Electrify, attenuate the incoming irradiance used by the existing solar calculation, then let that calculation determine output. Keep smoke in the air separate from deposited ash and from damaged modules. DOE identifies both lost production and physical destruction as distinct PV risks. [DOE PV wildfire guidance](https://www.energy.gov/cmei/femp/solar-photovoltaic-hardening-resilience-wildfire).

### Transmission and access to otherwise usable generation

Wildfire can interrupt a power route while the generating plant remains available. On July 11, 2021, CAISO reported that the Bootleg Fire had tripped Oregon transmission lines and reduced supplies into its territory by as much as **3,500 MW**. It also instructed generators to defer routine maintenance so available generation could operate. [CAISO July 11, 2021 notice](https://www.caiso.com/Documents/California-ISO-Issues-Flex-Alert-for-Monday-July-12-due-to-Wildfires-Heat.pdf).

Model this as a constraint on the exposed corridor or connection. A utility's lost import capability depends on its access rights, alternative routes, and available neighboring supply; it cannot be inferred by applying the same percentage to every owned generator. Nor can the regional 3,500 MW figure be assigned directly to the game's small municipal system.

Resource location can be far from the served city. SFPUC describes its Hetch Hetchy system as including hydroelectric powerhouses and approximately 160 miles of transmission from Yosemite to the Bay Area. San Francisco city weather alone therefore cannot determine the exposure of its remote supply. [SFPUC system description](https://www.sfpuc.gov/about-us/our-systems/hetch-hetchy-power-system).

### Physical damage and longer recovery

LADWP's March 2025 infrastructure report attributes power losses to approximately **35,800 customers** during the January fires. It describes damaged poles, transformers, conductors, and a distributing station. Its **$78 million** temporary rebuild estimate includes windstorm, wildfire, and rainstorm effects, immediate response labor, and rehabilitation. The affected-customer count does not establish a simultaneous disconnected-load percentage, an outage duration, or a generator output limit. [LADWP March 20, 2025 report](https://cityclerk.lacity.org/onlinedocs/2025/25-0006-S23_rpt_dwp_3-20-25.pdf).

Long restoration tails are real when equipment is damaged. SCE's December 2020 Big Creek report describes hydro facilities, poles, and wire damaged by a fire that began in September, with restoration still underway. This supports site-specific damage and repair states. It does not support reducing every hydro plant by a common percentage whenever the service area's wildfire event starts. [SCE Big Creek restoration account](https://energized.edison.com/stories/historic-sce-restoration-ongoing-at-big-creek).

Thermal plants are not immune. EPRI's vulnerability inventory identifies dust and debris associated with drought or wildfire as possible causes of equipment wear, derates, or trips at thermal generation plants. The inventory supplies a mechanism, not a calibrated fleet-wide loss percentage. [EPRI vulnerability inventory, item 142](https://apps.epri.com/climate-vulnerabilities-adaptations/en/vulnerabilities.html).

Post-fire erosion can also affect watersheds and reservoirs, particularly after rain. Such effects belong to a delayed catchment or infrastructure response, with local evidence; they should not become an automatic immediate hydro penalty. [USGS post-fire sediment research](https://www.usgs.gov/centers/pcmsc/news/post-wildfire-sediment-yield-a-sierra-nevada-watershed).

## Proposed simulation model

Use four effects with separate causes, exposure, duration, and recovery:

| Effect                                     | What changes                                                                      | What determines its magnitude                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Preventive or incident-based disconnection | Grid service to affected customer areas                                           | Utility policy, exposed circuits, switching options, customer load, and outage hours |
| Transmission interruption                  | Available import or plant-connection capacity                                     | The affected route's safe transfer limit and the remaining usable paths              |
| Smoke                                      | Solar irradiance at exposed PV resources                                          | A smoke attenuation profile, solar conditions, and geographic overlap                |
| Physical damage                            | Usable equipment or connection capacity, repair expense, and restoration schedule | Damaged components, exposed capacity, access conditions, and repair progress         |

For a connected generator, delivered power is bounded by both available generation and its safe connection capacity. Partial availability can come from a measured or modeled fraction of units or connections being unavailable. A fractional percentage is an output of those losses, rather than a random shared input assigned to dissimilar plants.

An initial implementation can use a small set of researched exposure areas and connection groups without requiring a player-drawn electrical network. Record which assets depend on each group. Sample an incident footprint, then affect that group coherently. New custom plants need an explicit placement or documented exposure assumption; fuel alone cannot supply their geography.

Keep non-solar generation at its existing weather, fuel, and operating availability unless an exposure-based event changes it. This avoids inventing an extra wildfire penalty while leaving room for sourced thermal or hydro failure mechanisms later. Do not double-count drought losses already represented through hydro inflows or the same transmission interruption through both an import constraint and an unrelated plant derate.

### Resolve the duration problem before choosing percentages

Electrify currently represents each month with one day (`DAYS_PER_MONTH = 1` in [Constants.tsx](../src/Constants.tsx)); [the demand model](demand-model.md) documents the same convention. The wildfire's one- or two-month effects repeat their restrictions across the entire represented period. Real outage hours cannot simply be inserted into that clock without deciding how energy, storage, and finances should scale.

For example, under a deliberately simplified constant-load assumption, disconnecting 10% of demand for 48 hours in a 30-day month removes **0.667%** of that month's energy: `0.10 × 48 / 720`. It does not remove 10% for the whole month. This is an illustrative calculation, not a proposed California outage frequency or severity.

Weighted normal and incident profiles could preserve monthly energy and cash totals, but averaging a two-day event into a small continuous derate does not preserve its peak shortage or battery endurance. Short outages need a chronological incident calculation through the owning simulation APIs, with consecutive outage hours and persistent battery state. A first release that only applies an energy-equivalent monthly adjustment should describe that limitation and must not use it to claim realistic backup-storage performance.

### Tie preparedness to specific actions

Replace the universal 50% reduction in disconnected load and generator losses with explicit mechanisms:

- Inspection and staged repair crews can shorten inspection or repair delays after access becomes safe. They do not shorten the hazardous weather itself.
- Sectionalization and switching can keep unaffected customer areas energized while isolating unsafe equipment.
- Local backup generation and island-capable solar/storage can serve eligible customer loads during isolation, subject to power, energy, and fuel limits.
- Grid hardening or vegetation work can alter the susceptibility of the assets actually treated. Any numerical benefit needs evidence appropriate to that treatment.

PG&E's revised 2024 report attributes avoided disconnections to sectionalization, switching, temporary microgrids, and backup support; it also reports restoration exceptions caused by terrain, nightfall, and required repairs. These support the proposed mechanisms, but reported avoided-customer counts are utility-estimated counterfactuals, not a randomized estimate of a universal mitigation effect. [PG&E revised post-season report, mitigation and restoration sections](https://www.pge.com/assets/pge/docs/outages-and-safety/outage-preparedness-and-support/2024-post-season-report-1-narrative.pdf).

Extra central generation cannot deliver through an isolated feeder. Customer backup requires the appropriate electrical arrangement: DOE explains that ordinary grid-following solar shuts off during an outage, while properly configured island-capable systems can continue supplying local loads. Do not assume every existing customer battery installation or utility battery can serve every disconnected customer. [DOE solar and resilience explanation](https://www.energy.gov/cmei/systems/solar-and-resilience-basics).

Keep customer service losses visible separately from generation adequacy for the still-connected grid. A disconnection can reduce grid sales and required dispatch without improving customer service. Planned safety isolation should not appear as successful demand reduction; its safety purpose and customer impact can both be recorded.

## How to obtain parameters without another arbitrary table

1. **Define the represented utility and assets.** Distinguish LADWP, a PG&E-served grid, and an abstract regional custom system. Record the policy period. Attach exposure to the service area, remote resources, and delivery routes separately. The existing [hydro site catalogue](hydro-sites.md) already provides coordinates for conventional hydro sites; other generation and connections need equivalent exposure metadata or an explicitly documented coarse approximation.

2. **Build separate event libraries.** Use final or amended utility post-event reports for circuit outages, CPUC reports for PSPS, CAISO records for transmission losses, and PV research or irradiance data for smoke. Preserve event date, utility, mechanism, affected area, outage start, weather all-clear, restoration, affected customers, measured load or lost MW where available, mitigation, and source revision. Do not treat a missing report as a zero-impact observation. Repeated customer events and unique customers are different denominators.

3. **Estimate exposure and weather danger separately.** NWS fire-weather criteria include fuel conditions, humidity, and wind; temperature and daily mean wind alone omit important controls. [NWS criteria explanation](https://www.weather.gov/gjt/firewxcriteria). CEMS provides globally reconstructed fire-danger indices using ERA5, including fuel-moisture-related indices. Such an index is a danger covariate, not the probability of a disruptive electrical incident. [ECMWF dataset](https://www.ecmwf.int/en/forecasts/datasets/fire-danger-indices-historical-data-copernicus-emergency-management-service), [CEMS user guide](https://confluence.ecmwf.int/spaces/CEMS/pages/340779714/User+Guide+for+Fire+danger+indices+historical+data+from+the+Copernicus+Emergency+Management+Service).

   The current `RawWeatherType` includes precipitation but no humidity field. A moisture-aware index therefore needs additional source data or a precomputed index; renaming the existing temperature/wind modifier would not supply the missing information.

4. **Use maps for their actual scope.** CAL FIRE historical perimeters can support exposure and seasonality work, but include omissions and changing reporting criteria. [CAL FIRE metadata](https://www.fire.ca.gov/what-we-do/fire-resource-assessment-program/fire-perimeters). US Forest Service community risk products describe wildfire hazard and exposure and are not finely calibrated electrical-asset failure models. A pixel's burn probability is not the probability of any outage somewhere in an entire utility territory. [USFS product scope](https://research.fs.usda.gov/firelab/products/dataandtools/wildfire-risk-communities), [wildfire likelihood definition](https://wildfirerisk.org/understand-risk/).

5. **Sample events jointly.** Preserve observed relationships among footprint, duration, smoke, load, and weather by resampling suitable episode blocks or fitting a small conditional model. Do not independently roll every generator, import route, and customer fraction. Preserve clustering and genuine no-event periods. Apply known policy or infrastructure changes before transferring frequencies across years or utilities.

6. **Calibrate smoke against a suitable baseline.** Use smoke-free irradiance comparisons or a radiative-transfer-informed attenuation profile. Satellite smoke polygons can identify overlap, but surface air-quality readings alone do not determine the optical properties of the full smoke column. The Corwin study combines satellite smoke, aerosols, clouds, and irradiance rather than assigning one loss to any smoke observation. Its NSRDB irradiance already includes aerosol effects, so using those irradiance series plus an additional smoke factor could double-count the loss. [Corwin et al., methods](https://www.nature.com/articles/s41467-024-54163-8). The current [Weather.tsx](../src/data/Weather.tsx) irradiance approximation explicitly includes cloud cover and no other weather, so it does not yet have that particular double-counting problem.

7. **Validate on withheld episodes and report the remaining assumptions.** Compare customer-hours interrupted, load-weighted unserved MWh, lost transfer MW-hours, PV energy loss, recovery duration, and direct utility costs. Hold out complete weather episodes or years rather than mixing correlated circuit rows between training and validation. Report both ordinary cases and damaging extremes. Fit frequencies and exposure before tuning the game's money or objectives; difficulty can change financial slack or the chosen stress case without being presented as a different physical law.

Customer counts require class-specific load estimates before they become a disconnected-demand share. Repair costs require asset and labor scope; interrupted MWh alone do not identify damaged infrastructure. Insurance, rebuilding, response, replacement energy, and liability should remain distinguishable where their treatment affects gameplay.

## Recommended first implementation

| Existing assumption                                                  | Proposed replacement                                                                                                                          |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Randomly select generators until 30–70% of fleet capacity is reached | Select an exposed delivery area or route, then derive the affected resources and customers                                                    |
| One 25–65% retained-output range across selected fuel types          | No added generic generation derate; smoke changes PV irradiance, while damage or lost connections change the exposed equipment's availability |
| All effects last one or two full months                              | Distinct outage hours, smoke episodes, and equipment repair tails, with explicit handling of the representative-day clock                     |
| Every funded preparedness program halves both losses                 | Mechanism-specific switching, inspection, restoration, and eligible backup benefits                                                           |
| Fixed regional incident rate plus six-month cooldown                 | Utility- and period-specific episode frequency, seasonality, and clustering estimated from the relevant records                               |
| Disconnected demand disappears from the main service story           | Preserve both customer interruption metrics and connected-grid adequacy                                                                       |

For the January 2025 LADWP mission, the researched basis is a distribution restoration and emergency-response problem. Retaining a months-long repair budget can be justified by its damaged infrastructure; the report does not establish a matching months-long derate on an arbitrary generation portfolio. A generation-adequacy mission can use a separately researched smoke episode or transmission-loss case, with its own historical date and scope.

Before implementation, the remaining calibration work is to extract and reconcile those event records and choose an explicit treatment of short events in the representative-day engine. The research above establishes mechanisms and numerical benchmarks; it does not supply a validated probability distribution for every city's future events.

Implementation verification should demonstrate that unexposed plants receive no extra penalty; disabled connections cannot carry power; PV attenuation applies only to the smoke-exposed solar resource; restoration spending and elapsed outage time are counted once; preparedness changes its intended mechanism; backup cannot reset its state of charge during a continuing outage; and save, forecast, and replay resolve the same persisted episode. Within a mechanism, increasing damage or smoke must not improve availability. These contracts would also catch the current recurring-fire severity/output inversion identified during the wording change.
