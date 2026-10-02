# Data-center setup demand and capacity calibration

Research snapshot: October 1, 2026. These inputs describe named utility territories,
not municipal population or metropolitan data-center markets. The fixed sales snapshot
is used for any selected opening year; it is not a reconstruction of historical demand
or a prediction of future utility plans. Edited account counts scale its annual energy
and, where available, peak proportionally.

| Location / territory          |  Accounts | Annual energy (MWh) |   Year | Observed peak (MW) |
| ----------------------------- | --------: | ------------------: | -----: | -----------------: |
| Austin Energy                 |   575,087 |          14,501,373 | FY2025 |              2,938 |
| Seattle City Light            |   513,504 |           8,938,932 |   2024 |              2,027 |
| Dallas / full Oncor territory | 4,111,000 |         172,775,000 |   2025 |            ~31,000 |
| Pittsburgh / Duquesne Light   |   615,768 |          12,743,605 |   2024 |                  — |
| Phoenix / APS territory       | 1,400,036 |          33,701,000 |   2024 |                  — |
| San Francisco / CleanPowerSF  |   384,194 |           2,844,945 |   2024 |                  — |
| Honolulu / Oahu only          |   309,839 |           6,134,550 |   2024 |                  — |
| Manassas municipal utility    |    16,624 |             394,352 |   2024 |                  — |
| Los Angeles / LADWP           | 1,510,995 |          21,347,075 |   2024 |                  — |
| Echo Summit / Liberty CalPeco |    50,030 |             573,460 |   2024 |                  — |
| San Juan / Puerto Rico        | 1,511,847 |          17,229,804 |   2024 |                  — |

## Primary references and scope

- Austin accounts and retail sales: [utility statistics](https://austinenergy.com/about/company-profile/numbers).
  Peak and portfolio: [FY2025 annual report](https://austinenergy.com/-/media/Project/Websites/AustinEnergy/About/PDFs/2025_Annual-Report.pdf),
  pages 9 and 13. Contracted renewable capacity is part of the supply portfolio,
  not dependable peak capacity.
- Seattle: [Fingertip Facts](https://www.seattle.gov/Documents/Departments/CityLight/FingertipFacts.pdf)
  and [2025 Official Statement](https://www.seattle.gov/documents/Departments/InvestorRelations/2025%20Documents/Seattle%20City%20Light%202025%20OS.pdf),
  Table 8. Use retail sales, excluding system losses and wholesale energy. The 2024
  energy mix (77% hydro) is not a nameplate-capacity mix; BPA purchases do not have
  a fixed nameplate entitlement.
- Oncor: [2025 operating statistics, Table D](https://www.sec.gov/Archives/edgar/data/1193311/000119312526073624/d17515dex991.htm)
  and [September 2025 investor presentation](https://www.oncor.com/content/dam/oncorwww/documents/investorrelations/financial-news/2025%20EEI%20Investor%20Presentation.pdf),
  pages 19–20. Oncor distributes power. Texas generation capacity remains an
  explicitly labeled grid proxy; it is not an Oncor-owned generation fleet.
- Duquesne: [2024 corporate responsibility report](https://www.duquesnelight.com/docs/default-source/default-document-library/dlc-corporate-responsibility-report.pdf?sfvrsn=db1aed44_3).
  Retail sectors sum to 12,743,605 MWh; exclude 4,274,756 MWh wholesale sales.
- APS: [2024 operating statistics](https://www.sec.gov/Archives/edgar/data/7286/000076462225000022/q4_2024xearningsxfinal.htm).
  Matched average accounts and retail sales; not all Phoenix suppliers.
- Remaining US territories: [EIA-861 final 2024 files](https://www.eia.gov/electricity/data/eia861/zip/f8612024.zip),
  `Sales_Ult_Cust_2024.xlsx`, total Customers and Sales columns. Utility IDs:
  CleanPowerSF 60181 (Energy), Oahu 19547 (Bundled), Manassas 11560 (Bundled),
  LADWP 11208 (Bundled), Liberty CalPeco 57483 (Bundled), Puerto Rico 15497
  (Bundled, Territories sheet). Do not add delivery and energy supplier records
  for the same customers. Calendar-year CleanPowerSF figures differ from SFPUC's
  fiscal-year sales and are paired here with EIA's calendar-year accounts.

## Model contract

The setup forecasts the real reducer's first year with the new campus set to zero.
It normalizes average demand to published annual energy using the game's equally
weighted representative days (mean watts × 8,760 hours). Where an observed peak is
available, it first fits the weather/day demand shape's peak-to-average ratio using
the deterministic `pow` helper. This matches annual energy and peak, not an actual
hourly utility load trace. Other locations retain the game's climate/sector shape.
Locations without verified sales retain explicitly disclosed model assumptions;
reference-utility account sizes can carry that reference's energy per account.

Supply is bracketed and bisected in the actual dispatch model to find a small
opening portfolio that serves background demand with a 5% allowance. This is a
model supply margin, not a reported utility reserve requirement or a resource
adequacy study. Hydro ceilings, plant rounding and unavailable regional imports
can change the source capacity mix. Labeled modeled gas backup covers missing
firm resources where necessary. No capacity is added for the selected campus.
Future background growth still requires investment. Opening cash covers the
worst first-year drawdown, not a guarantee of long-term solvency.

Dedicated setup projects add the selected MW as a constant total electricity
draw, including cooling. Thus 100 MW adds 876,000 MWh/year: about 6.0% of Austin
Energy sales, 9.8% of Seattle sales and 0.51% of Oncor deliveries. These differences
are realistic consequences of service-territory size. Authored Data Center Boom
retains its 90% annual utilization, now flat at 90 MW for its 100 MW nameplate.
No load schedule invents a January peak and July trough for a data center.

## Existing data centers and growth

Measured retail sales already contain operating data centers. The regional
data-center share splits that total; it must not add existing load a second time.
Both zero-project and growth runs retain that share and its regional trajectory.
`supplementsBackground` distinguishes a new marginal campus from legacy authored
schedules that describe the whole scenario-specific data-center sector.

Current utility-wide operating data-center MW are not verified for these three
territories. The split/growth remains a disclosed national/state model proxy:

- [Austin's August 2026 memo](https://services.austintexas.gov/edims/document.cfm?id=479388)
  reports ten existing customers, each 1–20 MW, without a summed operating load.
  The older 124 MW “running or planned” and 500 MW by 2040 assumptions are not
  operating measurements.
- [Seattle's 2026 demand-side assessment](https://www.seattle.gov/documents/departments/citylight/demandsidemanagementpotentialassessment.pdf)
  projects centers at 8% of **2045 commercial** energy; it does not establish
  today's total-system share. Proposed 369 MW requests are not operating load.
- [ERCOT's August 2025 observations](https://www.ercot.com/files/docs/2025/08/11/LLWG_DataCenterObs.pptx)
  show roughly 3.2–3.3 GW of traditional operating demand across ERCOT, with
  near-flat storage loads and modest afternoon compute peaks. This is not
  Oncor-specific. Approved-to-energize capacity and interconnection queues are
  excluded from measured background demand.

Decision-count/category targets live only in headless balance benchmarks. They
are neither mission requirements nor grounds to fire a player.
