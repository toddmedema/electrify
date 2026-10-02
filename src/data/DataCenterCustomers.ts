import { LocationType } from "../Types";

export interface DataCenterCustomerProfile {
  customers: number;
  serviceArea: string;
  sourceLabel: string;
  sourceUrl: string;
  sourceYear?: number;
  /** Retail/delivered energy for this same territory, including existing data centers. */
  annualMWh?: number;
  energySourceUrl?: string;
  energySourceYear?: number;
  /** Observed peak reference used to calibrate the modeled peak-to-average ratio. */
  observedPeakW?: number;
  basis: "local-utility" | "reference-utility";
  note: string;
}

type CustomerSource = Omit<DataCenterCustomerProfile, "basis">;

// Published electricity accounts/meters, never population. Rounded source claims
// ("more than", "approximately") retain their published precision. These are fixed
// snapshots, not estimates for the user's selected starting year. See docs/data-center-customers.md.
const SOURCES: Record<string, CustomerSource> = {
  PIT: {
    customers: 615768,
    serviceArea: "Duquesne Light service area, southwestern Pennsylvania",
    sourceLabel: "Duquesne Light corporate responsibility report, 2024",
    sourceUrl:
      "https://www.duquesnelight.com/docs/default-source/default-document-library/dlc-corporate-responsibility-report.pdf?sfvrsn=db1aed44_3",
    sourceYear: 2024,
    annualMWh: 12743605,
    energySourceYear: 2024,
    note: "Electricity accounts and retail sales across two counties, including Pittsburgh; wholesale sales are excluded.",
  },
  SF: {
    customers: 384194,
    serviceArea: "CleanPowerSF customers in San Francisco",
    sourceLabel: "EIA-861 electricity accounts and sales, 2024",
    sourceUrl: "https://www.eia.gov/electricity/data/eia861/zip/f8612024.zip",
    sourceYear: 2024,
    annualMWh: 2844945,
    energySourceYear: 2024,
    note: "CleanPowerSF electricity accounts and retail sales in calendar 2024; excludes Hetch Hetchy Power and other suppliers.",
  },
  HNL: {
    customers: 309839,
    serviceArea: "Hawaiian Electric, Oahu",
    sourceLabel: "EIA-861 electricity accounts and sales, 2024",
    sourceUrl: "https://www.eia.gov/electricity/data/eia861/zip/f8612024.zip",
    sourceYear: 2024,
    annualMWh: 6134550,
    energySourceYear: 2024,
    note: "Oahu electricity accounts and retail sales in 2024; excludes Hawaii and Maui subsidiaries.",
  },
  LA: {
    customers: 1510995,
    serviceArea: "Los Angeles Department of Water and Power",
    sourceLabel: "EIA-861 electricity accounts and sales, 2024",
    sourceUrl: "https://www.eia.gov/electricity/data/eia861/zip/f8612024.zip",
    sourceYear: 2024,
    annualMWh: 21347075,
    energySourceYear: 2024,
    note: "LADWP electricity accounts and retail sales in 2024; water accounts and wholesale energy are excluded.",
  },
  CAMountains: {
    customers: 50030,
    serviceArea: "Liberty CalPeco, California Lake Tahoe area",
    sourceLabel: "EIA-861 electricity accounts and sales, 2024",
    sourceUrl: "https://www.eia.gov/electricity/data/eia861/zip/f8612024.zip",
    sourceYear: 2024,
    annualMWh: 573460,
    energySourceYear: 2024,
    note: "Liberty CalPeco electricity accounts and retail sales in 2024; not Echo Summit alone.",
  },
  SJU: {
    customers: 1511847,
    serviceArea: "LUMA, Puerto Rico",
    sourceLabel: "EIA-861 electricity accounts and sales, 2024",
    sourceUrl: "https://www.eia.gov/electricity/data/eia861/zip/f8612024.zip",
    sourceYear: 2024,
    annualMWh: 17229804,
    energySourceYear: 2024,
    note: "Puerto Rico electricity accounts and retail sales in 2024; not San Juan alone.",
  },
  Manassas: {
    customers: 16624,
    serviceArea: "City of Manassas municipal electric utility",
    sourceLabel: "EIA-861 electricity accounts and sales, 2024",
    sourceUrl: "https://www.eia.gov/electricity/data/eia861/zip/f8612024.zip",
    sourceYear: 2024,
    annualMWh: 394352,
    energySourceYear: 2024,
    note: "Municipal electricity accounts and retail sales in 2024; not the wider Northern Virginia data-center market.",
  },
  Austin: {
    customers: 575087,
    serviceArea: "Austin Energy service territory",
    sourceLabel: "Austin Energy statistics, FY2025",
    sourceUrl: "https://austinenergy.com/about/company-profile/numbers",
    sourceYear: 2025,
    annualMWh: 14501373,
    energySourceYear: 2025,
    observedPeakW: 2938000000,
    note: "Austin Energy electricity accounts and retail sales; not the Austin–San Antonio metropolitan area.",
  },
  Seattle: {
    customers: 513504,
    serviceArea:
      "Seattle City Light service territory, including nearby suburbs",
    sourceLabel: "Seattle City Light Fingertip Facts, 2024",
    sourceUrl:
      "https://www.seattle.gov/Documents/Departments/CityLight/FingertipFacts.pdf",
    sourceYear: 2024,
    annualMWh: 8938932,
    energySourceYear: 2024,
    observedPeakW: 2027000000,
    note: "Matched 2024 average electricity accounts and retail sales; system losses and wholesale energy are excluded.",
  },
  Dallas: {
    customers: 4111000,
    serviceArea: "Oncor distribution service territory across Texas",
    sourceLabel: "Oncor operating statistics, 2025 (Table D)",
    sourceUrl:
      "https://www.sec.gov/Archives/edgar/data/1193311/000119312526073624/d17515dex991.htm",
    sourceYear: 2025,
    annualMWh: 172775000,
    energySourceYear: 2025,
    observedPeakW: 31000000000,
    note: "Full Oncor territory, not Dallas city. Oncor distributes power; the Texas generation mix is an example grid proxy.",
  },
  Phoenix: {
    customers: 1400036,
    serviceArea: "Arizona Public Service territory across Arizona",
    sourceLabel: "Arizona Public Service operating statistics, 2024",
    sourceUrl:
      "https://www.sec.gov/Archives/edgar/data/7286/000076462225000022/q4_2024xearningsxfinal.htm",
    sourceYear: 2024,
    annualMWh: 33701000,
    energySourceYear: 2024,
    note: "Average electricity accounts and retail sales across APS territory; not all Phoenix utilities or Phoenix city alone.",
  },
  Delhi: {
    customers: 2000000,
    serviceArea: "Tata Power-DDL, North and North-West Delhi",
    sourceLabel: "Tata Power regulatory filing, March 2025",
    sourceUrl:
      "https://www.tatapower.com/regulatory/license-area-maharashtra/fy-2024-2025/tata-power-company-limited-petition-for-bhandup-mmr-19-03-2025.pdf",
    sourceYear: 2024,
    note: "About 2 million registered accounts at March 31, 2024; excludes the rest of Delhi's suppliers.",
  },
  Johannesburg: {
    customers: 380000,
    serviceArea: "City Power, Johannesburg",
    sourceLabel: "South African Parliament oversight report, May 2025",
    sourceUrl:
      "https://www.parliament.gov.za/storage/app/media/Docs/atc/01ls62wgcfl6tu5ztpp5c3t3zhsx2n2by2.pdf",
    sourceYear: 2025,
    note: "About 380,000 City Power consumers (PDF page 67); excludes customers served directly by Eskom.",
  },
  London: {
    customers: 2400000,
    serviceArea: "UK Power Networks, London network",
    sourceLabel: "UK Power Networks: Bengeworth Road",
    sourceUrl: "https://www.ukpowernetworks.co.uk/bengeworth-road",
    note: "More than 2.4 million homes and businesses in the supplier's London network; not every Greater London account.",
  },
  Dublin: {
    customers: 2400000,
    serviceArea: "ESB Networks, Republic of Ireland",
    sourceLabel: "ESB Networks: Our people",
    sourceUrl: "https://www.esbnetworks.ie/about-us/company/our-people",
    note: "Approximately 2.4 million homes, farms and businesses nationwide; not Dublin alone.",
  },
  Sydney: {
    customers: 1800000,
    serviceArea: "Ausgrid, Sydney, Central Coast and Hunter Valley",
    sourceLabel: "Ausgrid: Sustainability and environment",
    sourceUrl:
      "https://www.ausgrid.com.au/about-us/sustainability-and-environment",
    note: "Approximately 1.8 million accounts across Ausgrid's network; not Sydney alone.",
  },
  Singapore: {
    customers: 1700000,
    serviceArea: "SP Group, Singapore electricity network",
    sourceLabel: "SP Group: PowerGrid overview",
    sourceUrl: "https://www.spgroup.com.sg/our-services/network/overview",
    note: "Approximately 1.7 million electricity customers across Singapore.",
  },
  HongKong: {
    customers: 2789644,
    serviceArea:
      "CLP Power, Kowloon, New Territories and most outlying islands",
    sourceLabel: "CLP sustainability report, 2023",
    sourceUrl:
      "https://sustainability.clpgroup.com/en/2023/serving-our-stakeholders/customers",
    sourceYear: 2023,
    note: "Sum of residential, commercial, manufacturing and infrastructure accounts; excludes Hongkong Electric's territory.",
  },
  SaoPaulo: {
    customers: 8500000,
    serviceArea: "Enel Distribuicao Sao Paulo, 24 metropolitan municipalities",
    sourceLabel: "Enel Sao Paulo company statement, September 2026",
    sourceUrl:
      "https://www.enel.com.br/pt-saopaulo/midia/press/d202609-enel-sp-horario-das-lojas-no-feriado-da-independencia.html",
    sourceYear: 2026,
    note: "Approximately 8.5 million consumer units across the concession; not Sao Paulo city alone.",
  },
  Dubai: {
    customers: 1225639,
    serviceArea: "DEWA, Emirate of Dubai",
    sourceLabel: "DEWA integrated report, 2024",
    sourceUrl:
      "https://www.dewa.gov.ae/-/media/Images/Investor-Relations/Integrated-reports/Integrated_report_for_the_year_2024.ashx",
    sourceYear: 2024,
    note: "Electricity accounts only; excludes water-only customers.",
  },
  Tbilisi: {
    customers: 780700,
    serviceArea: "Telasi, Tbilisi distribution territory",
    sourceLabel: "Telasi operational indicators, 2024",
    sourceUrl:
      "https://www.telasi.ge/en/company-news/news/3566-ss-telasis-2024-tslis-operatsiuli-machveneblebi",
    sourceYear: 2024,
    note: "780.7 thousand residential and legal-entity customers at December 2024.",
  },
  Almaty: {
    customers: 987583,
    serviceArea: "AlmatyEnergoSbyt, Almaty city and region",
    sourceLabel: "Samruk-Energy annual report, 2024",
    sourceUrl:
      "https://ar2024.samruk-energy.kz/en/kazakhstan-power-and-coal-markets.html",
    sourceYear: 2024,
    note: "2024 consumer accounts in Almaty city and region; supplier merged into Alatau Zharyk Company in 2025.",
  },
};

const REGION_REFERENCES: Record<string, string> = {
  "North America": "PIT",
  "South America": "SaoPaulo",
  Europe: "London",
  Africa: "Johannesburg",
  "Middle East": "Dubai",
  Caucasus: "Tbilisi",
  "Central Asia": "Almaty",
  "South Asia": "Delhi",
  "East Asia": "HongKong",
  "Southeast Asia": "Singapore",
  Oceania: "Sydney",
};

export function getDataCenterCustomerProfile(
  location: LocationType,
): DataCenterCustomerProfile {
  const local = SOURCES[location.id];
  if (local) return { ...local, basis: "local-utility" };
  const reference = SOURCES[REGION_REFERENCES[location.region || ""] || "PIT"];
  return {
    ...reference,
    basis: "reference-utility",
    note: `No verified local account count is available. This is an example sized to ${reference.serviceArea}, not an estimate for ${location.name}. Change the account count to match your community.`,
  };
}
