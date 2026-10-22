# Wildfire calibration evidence

Verified October 21, 2026. This note records quantitative inputs and their limits for the
replacement wildfire model. The broader mechanism review is in
[wildfire-model-research.md](wildfire-model-research.md).

## A regional smoke episode that can be reproduced

NREL report NREL/TP-5D00-86640, Figure 18 (printed page 28; PDF page 38), compares
modeled 2020 smoke with a no-wildfire counterfactual. Its labeled regional mean reductions
in clear-sky global horizontal irradiance are:

| Local date | Greater Bay Area | Los Angeles metropolitan area |
| ---------- | ---------------- | ----------------------------- |
| 2020-09-10 | 23%              | 19%                           |
| 2020-09-11 | 22%              | 18%                           |
| 2020-09-12 | 17%              | 12%                           |
| 2020-09-13 | 15%              | 16%                           |
| 2020-09-14 | 10%              | 16%                           |

The figure samples **10 a.m. to 6 p.m. local daylight time**. These are regional,
modeled irradiance losses, rounded to whole percentages in the source; they are not
hourly observations or individual-plant output limits. Keep the five-day order.
The report's separate **7.7% monthly PV loss** concerns its statewide modeled fleet,
not either city's five-day episode.
[NREL report, Figure 18 and section 5.2.1](https://www.nlr.gov/docs/fy23osti/86640.pdf#page=38).

Applying those daily daytime ratios to the corresponding solar irradiance is a
documented approximation. The source does not establish the overnight or early-morning
attenuation, the shape within the eight-hour window, or a recurrence probability.
In particular, this episode cannot justify an annual Bernoulli rate or a table of
monthly incident probabilities.

For a representative-day simulation, a monthly energy adjustment must distinguish the
five affected days from the remaining days. The exact loss depends on solar energy in
the sampled window. If every day had equal solar energy and the ratios were extended to
all daylight hours, the arithmetic September means would be **2.9% Bay Area** and
**2.7% Los Angeles**. Those are derived illustrations, not observed monthly losses.
Using the actual modeled hourly irradiance as weights avoids claiming that equal-day
approximation is a measurement. A monthly average still does not reproduce multi-day
battery endurance or the episode's peak adequacy challenge.

The wider literature reinforces this separation: Corwin et al. distinguish strong local
smoke impacts from much smaller mean GHI changes under transported smoke. They publish
processed data and analysis code, which offer a route to a larger event library rather
than repeating this one stress episode every year.
[Corwin et al., data and code availability](https://www.nature.com/articles/s41467-024-54163-8#data-availability).

## PSPS records are utility records, not city hazard rates

The revised PG&E 2024 post-season report identifies six de-energization episodes, plus
a cancelled July 5 event. Its corrected customer counts for the first five episodes are:

| Episode                | Customer service points de-energized |
| ---------------------- | ------------------------------------ |
| July 2-3               | 1,833                                |
| July 20-21             | 212                                  |
| September 30-October 1 | 9,174                                |
| October 17-20          | 17,346                               |
| November 5-8           | 21,340                               |

These are event totals, not simultaneously disconnected demand shares. The revisions
matter: the October post-event report originally stated 17,367. Avoid mixing the
original and corrected denominators.
[PG&E revised 2024 post-season report, printed pages 2 and 5](https://www.pge.com/assets/pge/docs/outages-and-safety/outage-preparedness-and-support/2024-post-season-report-1-narrative.pdf#page=6).

The sixth event, December 9-10, affected 571 customer service points in the Tehachapi
Mountains, Kern County. Its reported average restoration time of 3.3 hours starts after
the weather all-clear; it is **not the complete outage duration**.
[PG&E December 2024 post-event report, printed pages 2-3](https://www.pge.com/assets/pge/docs/outages-and-safety/outage-preparedness-and-support/12-09-2024-psps-post-event-report.pdf#page=4).

PG&E explicitly reports no PSPS de-energizations in 2022 and lists four episodes in 2023. Preserve quiet years and event clustering if using these records in a suitable
PG&E territory model. A six-month cooldown is incompatible with the listed sequences.
[PG&E report archive, 2022-2024](https://www.pge.com/en/outages-and-safety/safety/community-wildfire-safety-program/public-safety-power-shutoffs.html).

For an actual-hour example, PG&E's October 2024 Appendix B lists Bucks Creek 1103,
Plumas County: off October 18 at 19:55, weather all-clear October 19 at 12:00,
and restored at 16:53. That is **20 hours 58 minutes total**, of which **4 hours
53 minutes** follows the all-clear. Its 304 customer service points are not an SF
customer count. The same table lists Brentwood 2105 in Contra Costa County: off
October 17 at 20:33 and restored October 19 at 14:23, **41 hours 50 minutes**,
with 71 service points. Circuit tables can bound interruption hours but do not supply
each customer's restoration time or load.
[PG&E October 2024 post-event report, Appendix B](https://www.pge.com/assets/pge/docs/outages-and-safety/outage-preparedness-and-support/10-17-2024-psps-post-event-report-amended.pdf#page=106).

None of those counts establishes a San Francisco city exposure rate. SFPUC describes
PSPS and rotating outages as infrequent in San Francisco.
[SFPUC summer preparedness guidance](https://www.sfpuc.gov/about-us/news/keep-your-cool-during-summer-heat-events).
Use a researched circuit or delivery-route footprint before transferring utility-wide
records into a city scenario. Customer counts also require class-specific demand
weights before they become disconnected MWh.

## Reproducible smoke detection history

[WildfireSmokeHistory.json](../src/data/WildfireSmokeHistory.json) contains a new
2017-2025 calendar derived from NOAA's annual HMS polygon bundles at the canonical
LA/SF coordinates in `scripts/cities.json`. Each date keeps the maximum overlapping
qualitative plume-density class. The source archive URL, byte length, and SHA-256
are retained for every year.

| Year | SF detected smoke days | LA detected smoke days | SF heavy days | LA heavy days |
| ---- | ---------------------- | ---------------------- | ------------- | ------------- |
| 2017 | 47                     | 25                     | 3             | 0             |
| 2018 | 51                     | 24                     | 10            | 3             |
| 2019 | 23                     | 7                      | 0             | 0             |
| 2020 | 66                     | 62                     | 29            | 13            |
| 2021 | 70                     | 62                     | 17            | 4             |
| 2022 | 35                     | 20                     | 0             | 1             |
| 2023 | 50                     | 30                     | 0             | 0             |
| 2024 | 41                     | 29                     | 0             | 0             |
| 2025 | 41                     | 40                     | 0             | 3             |

These are derived **detection counts**, not verified smoke-exposure counts. Three
dates have no polygons anywhere in their annual bundle (2017-11-12, 2018-12-31,
2023-05-12); they retain `?`. Code `0` means no local plume detected, without
claiming clear air. NOAA warns that cloud interference, changed sensors, and gaps
limit historical comparisons. UTC observation dates also differ from local dates.
[NOAA annual bundles](https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/Shapefile/Annual_Bundles/),
[NOAA HMS limitations](https://www.ospo.noaa.gov/products/land/hms.html).

All five NREL reference days coincide with heavy HMS detections at both city points.
This overlap supports using that severe episode as a **heavy-smoke stress template**;
it does not identify losses for light or medium smoke, or validate an exact loss for
every later heavy day. Keep those uncalibrated classes distinct. A calendar resampled
as complete years preserves detected seasonality, heavy-smoke quiet years, and
clusters without inventing an annual incident probability. It remains a replay of
detected plume history, rather than a calibrated future fire or outage forecast.

Regenerate with Python 3 (standard library only), then apply repository formatting:

```text
py scripts/research-wildfire-smoke.py
npx prettier --write src/data/WildfireSmokeHistory.json
py scripts/research-wildfire-smoke.test.py
```

The generator tests check polygon holes, boundaries, disconnected polygon parts,
leap-day indexing, maximum daily density, explicit unknown dates, and rejection of
truncated input. An independent extraction using pyshp 2.3.1 and Shapely 2.1.2 matched
all 6,574 city/date entries. Those libraries were temporary verification tools and
are not generator or application dependencies.

## LADWP's January 2025 emergency is a separate damage case

LADWP's June 2025 mitigation plan describes incident-based isolation and says it has
rejected pre-emptive shutoffs because of the effects on public safety. This is the
appropriate contemporary utility policy for a January 2025 mission; it is not PG&E's
preventive PSPS program.
[LADWP June 2025 mitigation plan, printed page 48](https://www.ladwp.com/sites/default/files/2025-12/LADWP%202025%20Wildfire%20Mitigation%20Plan.pdf#page=52).

The March 20 city report attributes approximately 35,800 customer interruptions to four
January fires. It estimates **$78 million** in temporary Power System rebuild costs
for the January **windstorm, wildfire, and rainstorms together**, including physical
damage, immediate response labor, and repair/rehabilitation. It is neither a pure
wildfire cost nor a cost per MWh. By the report date, power had been restored to all
undamaged/slightly damaged properties requesting service, while rebuilding continued.
The document does not give customer-hour totals or generator derates.
[LADWP March 20, 2025 infrastructure report](https://cityclerk.lacity.org/onlinedocs/2025/25-0006-S23_rpt_dwp_3-20-25.pdf).

A separate operational snapshot records about **8,000 customers still without power
on January 19**, in the Pacific Palisades and Santa Monica Canyon areas where access
or re-energization remained unsafe. The final 1,500 customers in Brentwood, Encino,
and Bel-Air were restored the preceding night. These snapshots support localized
distribution restoration rather than a common generation multiplier.
[LADWP January 19 evening update](https://ladwpnews.com/january-19-2025-evening-update-ladwps-windstorm-and-fire-response/).

## Local diesel backup emissions

The authored response allocates a 200 kW mobile unit at 75% loading for up to
24 hours, based on PG&E's published equipment inventory. Its actual engine model
is unknown. For a representative fuel curve, Cummins' October 2024 rental brochure
lists the C200D2RE at 200 kW standby/180 kW prime, consuming **8.9 US gallons/hour
at 135 kW** and **10.3 at 180 kW**. Linear interpolation at the modeled 150 kW
gives **9.3667 US gallons/hour**. This is an explicit equipment-transfer assumption.
[Cummins bulletin 5410691, C200D2RE column](https://mart.cummins.com/imagelibrary/data/assetfiles/0057134.pdf).

EPA's January 2025 Table 1 lists No. 2 distillate combustion factors of **10.21 kg
CO2**, **0.41 g CH4**, and **0.08 g N2O** per US gallon, with 100-year AR5 GWPs
of 28 and 265. Thus the fuel factor is `10.21 + 0.00041*28 + 0.00008*265 =
10.24268 kg CO2e/gallon`. At 150 kW the derived intensity is **639.5985 kg CO2e/MWh**,
or approximately **2,302.55 kg CO2e** if the entire 3.6 MWh allowance is used.
These are combustion emissions; upstream fuel, manufacture, auxiliary transport,
and diesel exhaust fluid are outside this estimate.
[EPA 2025 emission factors, Table 1](https://www.epa.gov/system/files/documents/2025-01/ghg-emission-factors-hub-2025.pdf).

## Implementation boundary

The evidence supports a deterministic regional smoke stress episode now. It also supports
removing generic cross-fuel derates, utility-wide customer lotteries, and repair costs
inferred from interrupted MWh. Keep the historical LADWP response budget separately
labeled and charged once. An uncalibrated mechanism should not silently inherit the old
random range.

A compact episode catalogue should retain:

- Stable ID, affected location/region, mechanism, and historical date range.
- Source URL, figure/table/page, source revision, and whether values are observed,
  modeled, or derived.
- Consecutive daily irradiance loss ratios and the local sampling-hour window for smoke.
- Affected circuits/customer classes, actual outage and restoration timestamps, and
  load weights for any later disconnection episode.
- Direct repair/response cost scope separately from lost sales and replacement energy.

Occurrence scheduling is a separate input from episode severity. Shipping researched
stress cases or resampling detected smoke calendars does not provide a validated future
hazard model. A future physical-risk model needs region-matched data on undetected smoke
and retained joint relationships between smoke, outages, and recovery. The sources above
do not establish wildfire or electrical-outage frequency for custom locations or for
San Francisco's distribution system.
