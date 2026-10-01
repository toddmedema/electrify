import { LocationType } from "../Types";

export interface DataCenterCustomerProfile {
  customers: number;
  serviceArea: string;
  sourceLabel: string;
  sourceUrl: string;
  sourceYear?: number;
  basis: "local-utility" | "reference-utility";
  note: string;
}

type CustomerSource = Omit<DataCenterCustomerProfile, "basis">;

// Published electricity accounts/meters, never population. Rounded source claims
// ("more than", "approximately") retain their published precision. These are fixed
// snapshots, not estimates for the user's selected starting year. See docs/data-center-customers.md.
const SOURCES: Record<string, CustomerSource> = {
  PIT: {
    customers: 600000,
    serviceArea: "Duquesne Light service area, southwestern Pennsylvania",
    sourceLabel: "Duquesne Light: About us",
    sourceUrl: "https://www.duquesnelight.com/company/about",
    note: "More than 600,000 accounts across two counties, including Pittsburgh; not the city alone.",
  },
  SF: {
    customers: 380000,
    serviceArea: "CleanPowerSF customers in San Francisco",
    sourceLabel: "SFPUC customer accounts, February 2025",
    sourceUrl:
      "https://www.sfpuc.gov/about-us/news/cleanpowersf-provides-100-renewable-electricity-san-francisco-customers-two-years",
    sourceYear: 2025,
    note: "More than 380,000 CleanPowerSF accounts; excludes other suppliers' accounts, including Hetch Hetchy Power.",
  },
  HNL: {
    customers: 310789,
    serviceArea: "Hawaiian Electric, Oahu",
    sourceLabel: "Hawaiian Electric: Power facts, 2025",
    sourceUrl: "https://www.hawaiianelectric.com/about-us/power-facts",
    sourceYear: 2025,
    note: "All Oahu electricity customers as of December 31, 2025; not Honolulu alone.",
  },
  LA: {
    customers: 1500000,
    serviceArea: "Los Angeles Department of Water and Power",
    sourceLabel: "LADWP electricity customers, 2023",
    sourceUrl:
      "https://ladwpnews.com/la-board-of-water-power-commissioners-approve-policy-to-end-water-and-power-shutoffs-for-low-income-residential-customers-unable-to-pay-their-utility-bill/",
    sourceYear: 2023,
    note: "Approximately 1.5 million electric accounts; water accounts are excluded.",
  },
  CAMountains: {
    customers: 50000,
    serviceArea: "Liberty CalPeco, California Lake Tahoe area",
    sourceLabel: "Liberty CalPeco 2025 regulatory application",
    sourceUrl:
      "https://california.libertyutilities.com/uploads/A2510XXX-Liberty%20CalPeco%202025%20ECAC%20Application.pdf",
    sourceYear: 2025,
    note: "Approximately 50,000 accounts in and around the California Lake Tahoe Basin; not Echo Summit alone.",
  },
  SJU: {
    customers: 1500000,
    serviceArea: "LUMA, Puerto Rico",
    sourceLabel: "LUMA customer update, March 2025",
    sourceUrl:
      "https://lumapr.com/wp-content/uploads/2025/03/LUMA_March_Customer_Email_SPA_ENG.pdf",
    sourceYear: 2025,
    note: "Approximately 1.5 million accounts across Puerto Rico; not San Juan alone.",
  },
  Manassas: {
    customers: 17000,
    serviceArea: "City of Manassas municipal electric utility",
    sourceLabel: "Manassas 2045 Comprehensive Plan draft, 2025",
    sourceUrl:
      "https://cms9files.revize.com/manassasva/Community%20Development/Comp%20Plan/2045%20Comp%20Plan/2045%20Comprehensive%20Plan%20Draft%20-%208-5-25.pdf",
    sourceYear: 2025,
    note: "More than 17,000 residential, commercial and industrial meters within the city (Appendix C2, page 185).",
  },
  Phoenix: {
    customers: 1400000,
    serviceArea: "Arizona Public Service territory across Arizona",
    sourceLabel: "Arizona Public Service: About us",
    sourceUrl: "https://www.aps.com/about/",
    note: "Approximately 1.4 million accounts across the APS territory; not all Phoenix utilities or Phoenix city alone.",
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
