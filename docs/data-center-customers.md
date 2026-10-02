# Data-center setup: customer-account sources

Researched September 30, 2026. The old builder reused authored-scenario customer counts or
continent-wide round numbers. Neither is a researched inventory of the selected city's grid.
The dedicated builder now reads `src/data/DataCenterCustomers.ts` instead.

## What these numbers describe

Counts are **electricity accounts, connections or meters**, not residents. An account may serve
several people or one business. Counts describe a **named utility service area**, which often
crosses city boundaries, or covers only part of a city. The UI must identify that area alongside
the source link. They do not identify which power plants the utility owns or buys from.

Sources are fixed published snapshots. Selecting a starting year from 2010–2049 does not turn
them into historical counts or population forecasts. Users can change the account count to
match their intended community. Values published as “about”, “more than” or “approximately”
retain the source's rounded precision. Undated corporate profile pages have no invented year.

Updated October 1, 2026: the US setup now also calibrates annual electricity use.
See [demand calibration and matched source records](data-center-calibration.md) for
the current US accounts, sales and peak references; that table explains the matched account and energy records below.

## Local utility references

| Location      |  Accounts | Coverage and primary source                                                                                                                                                                                                                                                    |
| ------------- | --------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pittsburgh    |   615,768 | Duquesne Light two-county service territory; [2024 corporate responsibility report](https://www.duquesnelight.com/docs/default-source/default-document-library/dlc-corporate-responsibility-report.pdf?sfvrsn=db1aed44_3).                                                     |
| San Francisco |   384,194 | CleanPowerSF accounts, excluding Hetch Hetchy and other suppliers; [EIA-861 2024 accounts and retail sales](https://www.eia.gov/electricity/data/eia861/zip/f8612024.zip).                                                                                                     |
| Honolulu      |   309,839 | Oahu only, excluding subsidiaries; [EIA-861 2024 accounts and retail sales](https://www.eia.gov/electricity/data/eia861/zip/f8612024.zip).                                                                                                                                     |
| Los Angeles   | 1,510,995 | LADWP electricity accounts, excluding water; [EIA-861 2024 accounts and retail sales](https://www.eia.gov/electricity/data/eia861/zip/f8612024.zip).                                                                                                                           |
| Echo Summit   |    50,030 | Liberty CalPeco California territory; [EIA-861 2024 accounts and retail sales](https://www.eia.gov/electricity/data/eia861/zip/f8612024.zip).                                                                                                                                  |
| San Juan      | 1,511,847 | Puerto Rico territory; [EIA-861 2024 accounts and retail sales](https://www.eia.gov/electricity/data/eia861/zip/f8612024.zip).                                                                                                                                                 |
| Manassas      |    16,624 | Municipal electricity utility, not the wider metro area; [EIA-861 2024 accounts and retail sales](https://www.eia.gov/electricity/data/eia861/zip/f8612024.zip).                                                                                                               |
| Phoenix       | 1,400,036 | APS service territory; [2024 operating statistics](https://www.sec.gov/Archives/edgar/data/7286/000076462225000022/q4_2024xearningsxfinal.htm).                                                                                                                                |
| Austin        |   575,087 | Austin Energy service territory; [FY2025 statistics](https://austinenergy.com/about/company-profile/numbers).                                                                                                                                                                  |
| Seattle       |   513,504 | Seattle City Light territory; [2024 Fingertip Facts](https://www.seattle.gov/Documents/Departments/CityLight/FingertipFacts.pdf).                                                                                                                                              |
| Dallas        | 4,111,000 | Full Oncor distribution territory, not Dallas city; [2025 statistics](https://www.sec.gov/Archives/edgar/data/1193311/000119312526073624/d17515dex991.htm).                                                                                                                    |
| Delhi         | 2,000,000 | Tata Power-DDL's North and North-West Delhi accounts at March 31, 2024; [Tata Power March 2025 regulatory filing](https://www.tatapower.com/regulatory/license-area-maharashtra/fy-2024-2025/tata-power-company-limited-petition-for-bhandup-mmr-19-03-2025.pdf), paragraph 9. |
| Johannesburg  |   380,000 | City Power consumers, excluding Eskom-direct customers; [Parliament May 2025 oversight report](https://www.parliament.gov.za/storage/app/media/Docs/atc/01ls62wgcfl6tu5ztpp5c3t3zhsx2n2by2.pdf), PDF page 67.                                                                  |
| London        | 2,400,000 | UK Power Networks' London network; [Bengeworth Road project](https://www.ukpowernetworks.co.uk/bengeworth-road).                                                                                                                                                               |
| Dublin        | 2,400,000 | ESB Networks across the Republic of Ireland, not just Dublin; [ESB Networks profile](https://www.esbnetworks.ie/about-us/company/our-people).                                                                                                                                  |
| Sao Paulo     | 8,500,000 | Enel's 24-municipality concession; [September 2026 utility statement](https://www.enel.com.br/pt-saopaulo/midia/press/d202609-enel-sp-horario-das-lojas-no-feriado-da-independencia.html).                                                                                     |
| Dubai         | 1,225,639 | DEWA electricity accounts in 2024, excluding water-only customers; [integrated report](https://www.dewa.gov.ae/-/media/Images/Investor-Relations/Integrated-reports/Integrated_report_for_the_year_2024.ashx).                                                                 |
| Tbilisi       |   780,700 | Telasi distribution customers in December 2024; [operational indicators](https://www.telasi.ge/en/company-news/news/3566-ss-telasis-2024-tslis-operatsiuli-machveneblebi).                                                                                                     |
| Almaty        |   987,583 | AlmatyEnergoSbyt accounts across city and region in 2024; [Samruk-Energy annual report](https://ar2024.samruk-energy.kz/en/kazakhstan-power-and-coal-markets.html).                                                                                                            |

## Coverage gaps and regional examples

There is no verified local account count for every weather-catalog location. The lookup explicitly
marks those results `reference-utility`, using a researched utility as an **example size**, not as
an estimate for the selected city. Neither climate nor continent determines a city's account count.
The UI exposes this limitation and lets users enter their own count. This is deliberately different
from silently presenting an assumed number as local research.

References by region: North America uses Duquesne Light; South America uses Enel Sao Paulo;
Europe uses the London network; Africa uses City Power; Middle East uses DEWA; Caucasus uses
Telasi; Central Asia uses AlmatyEnergoSbyt; South Asia uses Tata Power-DDL. Three other references
support catalog expansion and remaining regions:

- East Asia: **2,789,644 CLP Power accounts** in 2023, covering Kowloon, New Territories and most
  outlying islands, excluding Hongkong Electric's area. Sum of residential 2,439,557, commercial
  214,616, manufacturing 16,923 and infrastructure/public-service 118,548 accounts in the
  [CLP sustainability report](https://sustainability.clpgroup.com/en/2023/serving-our-stakeholders/customers).
- Southeast Asia: **1.7 million** Singapore electricity customers,
  [SP Group PowerGrid overview](https://www.spgroup.com.sg/our-services/network/overview).
- Oceania: **1.8 million** Ausgrid accounts across Sydney, Central Coast and Hunter Valley,
  [Ausgrid profile](https://www.ausgrid.com.au/about-us/sustainability-and-environment).

Unknown regions use the explicitly labeled Duquesne Light reference. Exact location IDs select
local references; same-state or nearby-city matches are intentionally not inferred. The account
scope and the power-mix source's geographic scope can differ and must not be described as a
single reconstructed utility grid.
