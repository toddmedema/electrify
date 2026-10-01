# Data-center setup: customer-account sources

Researched September 30, 2026. The old builder reused authored-scenario customer counts or
continent-wide round numbers. Neither is a researched inventory of the selected city's grid.
The dedicated builder now reads `src/data/DataCenterCustomers.ts` instead.

## What these numbers describe

Counts are **electricity accounts, connections or meters**, not residents. An account may serve
several people or one business. Counts describe a **named utility service area**, which often
crosses city boundaries, or covers only part of a city. The UI must identify that area alongside
the source link. They do not identify which power plants the utility owns or buys from.

Sources are fixed published snapshots. Selecting a starting year from 2010–2050 does not turn
them into historical counts or population forecasts. Users can change the account count to
match their intended community. Values published as “about”, “more than” or “approximately”
retain the source's rounded precision. Undated corporate profile pages have no invented year.

## Local utility references

| Location      |  Accounts | Coverage and primary source                                                                                                                                                                                                                                                    |
| ------------- | --------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pittsburgh    |   600,000 | Duquesne Light's two-county territory, not just Pittsburgh; [utility profile](https://www.duquesnelight.com/company/about).                                                                                                                                                    |
| San Francisco |   380,000 | CleanPowerSF accounts, excluding other suppliers; [SFPUC February 2025 release](https://www.sfpuc.gov/about-us/news/cleanpowersf-provides-100-renewable-electricity-san-francisco-customers-two-years).                                                                        |
| Honolulu      |   310,789 | All Oahu, December 31, 2025; [Hawaiian Electric Power Facts](https://www.hawaiianelectric.com/about-us/power-facts).                                                                                                                                                           |
| Los Angeles   | 1,500,000 | Electric accounts, excluding water accounts; [LADWP 2023 release](https://ladwpnews.com/la-board-of-water-power-commissioners-approve-policy-to-end-water-and-power-shutoffs-for-low-income-residential-customers-unable-to-pay-their-utility-bill/).                          |
| Echo Summit   |    50,000 | Liberty's California Lake Tahoe territory, not this small settlement; [2025 regulatory application](https://california.libertyutilities.com/uploads/A2510XXX-Liberty%20CalPeco%202025%20ECAC%20Application.pdf).                                                               |
| San Juan      | 1,500,000 | LUMA's Puerto Rico territory, not just San Juan; [March 2025 customer update](https://lumapr.com/wp-content/uploads/2025/03/LUMA_March_Customer_Email_SPA_ENG.pdf).                                                                                                            |
| Manassas      |    17,000 | Municipal utility meters; [2025 draft comprehensive plan](https://cms9files.revize.com/manassasva/Community%20Development/Comp%20Plan/2045%20Comp%20Plan/2045%20Comprehensive%20Plan%20Draft%20-%208-5-25.pdf), Appendix C2, printed page 185.                                 |
| Phoenix       | 1,400,000 | APS's statewide territory, not just Phoenix and not all Phoenix utilities; [APS profile](https://www.aps.com/about/).                                                                                                                                                          |
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
