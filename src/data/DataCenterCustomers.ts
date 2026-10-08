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

export type DataCenterCustomerSources = Record<
  string,
  Omit<DataCenterCustomerProfile, "basis">
>;

// Published electricity accounts/meters, never population. Rounded source claims
// ("more than", "approximately") retain their published precision. These are fixed
// snapshots, not estimates for the user's selected starting year. Only the data-center
// setup needs them, so they are downloaded from /data rather than bundled. See
// docs/data-center-customers.md.
export const DATA_CENTER_CUSTOMERS_URL = "/data/data-center-customers.json";

const FALLBACK_REFERENCE = "PIT";
const REGION_REFERENCES: Record<string, string> = {
  "North America": FALLBACK_REFERENCE,
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

const optionalNumber = (value: unknown) =>
  value === undefined || (typeof value === "number" && value > 0);
const optionalString = (value: unknown) =>
  value === undefined || typeof value === "string";

function isSource(value: unknown): boolean {
  const source = value as Partial<DataCenterCustomerProfile> | null;
  return (
    typeof source === "object" &&
    source !== null &&
    Number.isInteger(source.customers) &&
    source.customers! > 0 &&
    ["serviceArea", "sourceLabel", "sourceUrl", "note"].every(
      (key) => typeof source[key as keyof typeof source] === "string",
    ) &&
    optionalString(source.energySourceUrl) &&
    [
      source.sourceYear,
      source.annualMWh,
      source.energySourceYear,
      source.observedPeakW,
    ].every(optionalNumber)
  );
}

/** Validates the downloaded file, including every regional example the lookup can fall back to. */
export function parseDataCenterCustomerSources(
  data: unknown,
): DataCenterCustomerSources {
  const sources = (data as { sources?: unknown } | null)?.sources;
  if (typeof sources !== "object" || sources === null) {
    throw new Error("the data-center customer file has no sources");
  }
  const invalid = Object.entries(sources).find(
    ([, source]) => !isSource(source),
  );
  if (invalid) {
    throw new Error(`invalid data-center customer source ${invalid[0]}`);
  }
  const missing = Object.values(REGION_REFERENCES).find(
    (id) => !(id in sources),
  );
  if (missing) {
    throw new Error(`missing regional customer reference ${missing}`);
  }
  return sources as DataCenterCustomerSources;
}

let loading: Promise<DataCenterCustomerSources> | undefined;

/** Downloads the sources once per session. A failure is not cached, so the caller can retry. */
export function initDataCenterCustomers(): Promise<DataCenterCustomerSources> {
  if (!loading) {
    loading = fetch(DATA_CENTER_CUSTOMERS_URL)
      .then((response: Response) => {
        if (!response.ok) {
          throw new Error(
            `${response.status} fetching data-center customer sources`,
          );
        }
        return response.json();
      })
      .then(parseDataCenterCustomerSources)
      .catch((e: Error) => {
        loading = undefined;
        throw e;
      });
  }
  return loading;
}

export function getDataCenterCustomerProfile(
  location: LocationType,
  sources: DataCenterCustomerSources,
): DataCenterCustomerProfile {
  const local = sources[location.id];
  if (local) return { ...local, basis: "local-utility" };
  const reference =
    sources[REGION_REFERENCES[location.region || ""] || FALLBACK_REFERENCE];
  return {
    ...reference,
    basis: "reference-utility",
    note: `No verified local account count is available. This is an example sized to ${reference.serviceArea}, not an estimate for ${location.name}. Change the account count to match your community.`,
  };
}
