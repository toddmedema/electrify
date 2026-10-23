#!/usr/bin/env node
/* Regenerate representative starting-age cohorts from WRI GPPD v1.3.0.
 * Node 24; no dependencies. Downloads stay in the OS temporary directory.
 * An existing CSV can be supplied with --input <path>; its checksum is verified.
 */
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const COMMIT = "7a91cfbb2a4e272597acbc00506d61fc1ec73b3d";
const URL = `https://raw.githubusercontent.com/wri/global-power-plant-database/${COMMIT}/output_database/global_power_plant_database.csv`;
const SHA256 =
  "4b1f93e0fd93664f18684d9b05d0a52ed9658c6a8cf0d21ff2520791379ba7fc";
const FIRST_YEAR = 2010;
const REFERENCE_YEAR = 2020;
const RENEWABLE_REFERENCE_YEAR = 2024;
const EMBER_URL =
  "https://files.ember-energy.org/public-downloads/yearly_full_release_long_format.csv";
const EMBER_SHA256 =
  "259e1095ee8ffeaf0aff37ad557916ae1823a2da13312da50ba4cec6b4574c3b";
const FUELS = {
  Coal: "Coal",
  Gas: "Natural Gas",
  Oil: "Oil",
  Petcoke: "Oil",
  Nuclear: "Uranium",
  Hydro: "Hydro",
  Solar: "Sun",
  Wind: "Wind",
  Biomass: "Biomass",
  Geothermal: "Geothermal",
};
const ALIASES = {
  "United States": "United States of America",
  Czechia: "Czech Republic",
  Syria: "Syrian Arab Republic",
  "Ivory Coast": "Cote DIvoire",
  "DR Congo": "Democratic Republic of the Congo",
  Brunei: "Brunei Darussalam",
};
const EMBER_ALIASES = {
  "United States": "United States of America",
  "Ivory Coast": "Cote d'Ivoire",
  "DR Congo": "Congo (the Democratic Republic of the)",
  Bahamas: "Bahamas (the)",
  Brunei: "Brunei Darussalam",
  "Dominican Republic": "Dominican Republic (the)",
  Iran: "Iran (Islamic Republic of)",
  Laos: "Lao People's Democratic Republic (the)",
  Niger: "Niger (the)",
  Philippines: "Philippines (the)",
  Russia: "Russian Federation (the)",
  Sudan: "Sudan (the)",
  Syria: "Syrian Arab Republic (the)",
  Tanzania: "Tanzania, the United Republic of",
  Venezuela: "Venezuela (Bolivarian Republic of)",
  Vietnam: "Viet Nam",
};

// GPPD uses RFC 4180 quoting, including escaped quotes and embedded newlines.
function* parseCsv(text) {
  let header;
  let row = [];
  let field = "";
  let quoted = false;
  const record = (values) => {
    if (values.length !== header.length)
      throw new Error("Unexpected CSV column count");
    return Object.fromEntries(header.map((key, i) => [key, values[i]]));
  };
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\r" || character === "\n") && !quoted) {
      if (character === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some(Boolean)) {
        if (!header) header = row;
        else yield record(row);
      }
      row = [];
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("Unclosed CSV field");
  if (field || row.length) yield record([...row, field]);
}

function add(group, fuel, capacity, year) {
  const record = (group[fuel] ??= {
    capacityMW: 0,
    knownCapacityMW: 0,
    years: {},
  });
  record.capacityMW += capacity;
  if (year !== undefined) {
    record.knownCapacityMW += capacity;
    record.years[year] = (record.years[year] || 0) + capacity;
  }
}

function finish(group) {
  return Object.fromEntries(
    Object.entries(group)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([fuel, record]) => [
        fuel,
        {
          capacityMW: Math.round(record.capacityMW * 100) / 100,
          knownCapacityMW: Math.round(record.knownCapacityMW * 100) / 100,
          ages: Array.from(
            { length: REFERENCE_YEAR - FIRST_YEAR + 1 },
            (_, index) => {
              const startingYear = FIRST_YEAR + index;
              let capacity = 0;
              let capacityAge = 0;
              for (const [year, mw] of Object.entries(record.years)) {
                // Scenarios begin on January 1. A plant first commissioned in the
                // starting year might not have entered operation yet.
                if (Number(year) >= startingYear) continue;
                capacity += mw;
                capacityAge += mw * (startingYear - Number(year));
              }
              return capacity
                ? Math.max(1, Math.round(capacityAge / capacity))
                : null;
            },
          ),
        },
      ]),
  );
}

async function source(flag, name, url, checksum) {
  const inputIndex = process.argv.indexOf(flag);
  const csvPath =
    inputIndex >= 0
      ? process.argv[inputIndex + 1]
      : path.join(os.tmpdir(), "electrify-power-research", name);
  if (!csvPath) throw new Error(`${flag} requires a CSV path`);
  let data;
  try {
    data = await fs.readFile(csvPath);
  } catch (error) {
    if (error.code !== "ENOENT" || inputIndex >= 0) throw error;
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Research download failed: ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
    await fs.mkdir(path.dirname(csvPath), { recursive: true });
    await fs.writeFile(csvPath, data);
  }
  if (createHash("sha256").update(data).digest("hex") !== checksum)
    throw new Error(`${name} checksum differs from the pinned research source`);
  return data.toString("utf8");
}

function renewableCohorts(history, baseline) {
  const cohorts = {};
  const annualCohorts = {};
  let previousCapacity = 0;
  for (let year = 2000; year <= RENEWABLE_REFERENCE_YEAR; year++) {
    const capacity = history[year];
    if (capacity === undefined) continue;
    if (year === 2000 && capacity > 0) {
      let known = 0;
      let capacityAge = 0;
      if (baseline && baseline.knownCapacityMW >= baseline.capacityMW * 0.5) {
        for (const [commissioned, mw] of Object.entries(baseline.years)) {
          if (Number(commissioned) >= 2000) continue;
          known += mw;
          capacityAge += mw * (2000 - Number(commissioned));
        }
      }
      const age = known ? capacityAge / known : 10;
      cohorts[2000 - age] = capacity;
    } else if (capacity >= previousCapacity) {
      if (capacity > previousCapacity)
        cohorts[year] = (cohorts[year] || 0) + capacity - previousCapacity;
    } else {
      // Net capacity cannot identify which individual plants retired. Retain
      // each vintage in the same proportion rather than invent a retirement order.
      const fraction = previousCapacity ? capacity / previousCapacity : 0;
      for (const commissioned of Object.keys(cohorts))
        cohorts[commissioned] *= fraction;
    }
    previousCapacity = capacity;
    annualCohorts[year] = { ...cohorts };
  }
  return annualCohorts;
}

async function renewableSnapshot(countryRegions, countries, regions, global) {
  const text = await source(
    "--ember-input",
    `ember-${EMBER_SHA256}.csv`,
    EMBER_URL,
    EMBER_SHA256,
  );
  const sourceNames = new Map(
    [...countryRegions.keys(), "World"].map((country) => [
      EMBER_ALIASES[country] || country,
      country,
    ]),
  );
  const histories = {};
  for (const row of parseCsv(text)) {
    const country = sourceNames.get(row.Area);
    const year = Number(row.Year);
    if (
      !country ||
      row.Category !== "Capacity" ||
      row.Subcategory !== "Fuel" ||
      row.Unit !== "GW" ||
      !["Solar", "Wind"].includes(row.Variable) ||
      !row.Value ||
      year < 2000 ||
      year > RENEWABLE_REFERENCE_YEAR
    )
      continue;
    const fuel = row.Variable === "Solar" ? "Sun" : "Wind";
    ((histories[country] ??= {})[fuel] ??= {})[year] = Number(row.Value) * 1000;
  }
  const profiles = {};
  const regionalProfiles = Object.fromEntries(
    Object.keys(regions).map((region) => [region, {}]),
  );
  for (const [country, fuels] of Object.entries(histories)) {
    profiles[country] = {};
    for (const [fuel, history] of Object.entries(fuels)) {
      const baseline =
        country === "World" ? global[fuel] : countries[country]?.[fuel];
      const annualCohorts = renewableCohorts(history, baseline);
      profiles[country][fuel] = { history, annualCohorts };
      if (country === "World") continue;
      for (const region of countryRegions.get(country)) {
        const target = (regionalProfiles[region][fuel] ??= {
          history: {},
          annualCohorts: {},
        });
        for (const [year, cohorts] of Object.entries(annualCohorts)) {
          const targetCohorts = (target.annualCohorts[year] ??= {});
          target.history[year] = (target.history[year] || 0) + history[year];
          for (const [commissioned, mw] of Object.entries(cohorts))
            targetCohorts[commissioned] =
              (targetCohorts[commissioned] || 0) + mw;
        }
      }
    }
  }
  const finishProfiles = (fuels) =>
    Object.fromEntries(
      Object.entries(fuels).map(([fuel, { history, annualCohorts }]) => {
        const capacityMW =
          Math.round((history[RENEWABLE_REFERENCE_YEAR] || 0) * 100) / 100;
        return [
          fuel,
          {
            capacityMW,
            knownCapacityMW: capacityMW,
            ages: Array.from(
              { length: RENEWABLE_REFERENCE_YEAR - FIRST_YEAR + 1 },
              (_, i) => {
                const startingYear = FIRST_YEAR + i;
                const cohorts = annualCohorts[startingYear - 1] || {};
                let capacity = 0;
                let capacityAge = 0;
                for (const [commissioned, mw] of Object.entries(cohorts)) {
                  capacity += mw;
                  capacityAge += mw * (startingYear - Number(commissioned));
                }
                return capacity
                  ? Math.max(1, Math.round(capacityAge / capacity))
                  : null;
              },
            ),
          },
        ];
      }),
    );
  return {
    firstYear: FIRST_YEAR,
    referenceYear: RENEWABLE_REFERENCE_YEAR,
    source: {
      title: "Ember Yearly Electricity Data, retrieved 2026-10-20",
      url: EMBER_URL,
      sha256: EMBER_SHA256,
      license: "CC BY 4.0",
      method: "capacity-net-additions",
    },
    global: finishProfiles(profiles.World),
    regions: Object.fromEntries(
      Object.entries(regionalProfiles).map(([region, fuels]) => [
        region,
        finishProfiles(fuels),
      ]),
    ),
    countries: Object.fromEntries(
      [...countryRegions.keys()]
        .sort()
        .map((country) => [country, finishProfiles(profiles[country] || {})]),
    ),
  };
}

async function main() {
  const rows = [
    ...parseCsv(await source("--input", `gppd-${COMMIT}.csv`, URL, SHA256)),
  ];
  const cities = Object.values(
    JSON.parse(
      await fs.readFile(
        path.join(ROOT, "public/data/weather/index.json"),
        "utf8",
      ),
    ).cities,
  );
  const countryRegions = new Map();
  for (const city of cities) {
    if (!countryRegions.has(city.country))
      countryRegions.set(city.country, new Set());
    countryRegions.get(city.country).add(city.region);
  }
  countryRegions.set("Puerto Rico", new Set(["North America"]));
  const sourceNames = new Map(
    [...countryRegions.keys()].map((country) => [
      ALIASES[country] || country,
      country,
    ]),
  );
  const countries = Object.fromEntries(
    [...countryRegions.keys()].sort().map((country) => [country, {}]),
  );
  const regions = Object.fromEntries(
    [...new Set([...countryRegions.values()].flatMap((value) => [...value]))]
      .sort()
      .map((region) => [region, {}]),
  );
  const global = {};
  for (const row of rows) {
    const fuel = FUELS[row.primary_fuel];
    const capacity = Number(row.capacity_mw);
    if (!fuel || !Number.isFinite(capacity) || capacity <= 0) continue;
    // Some plants have a fractional, unit-capacity-weighted commissioning year.
    // Preserve it to the nearest year, including floating-point 2020.0000000000002.
    const candidate = Math.round(Number(row.commissioning_year));
    const year =
      candidate >= 1850 && candidate <= REFERENCE_YEAR ? candidate : undefined;
    add(global, fuel, capacity, year);
    const country = sourceNames.get(row.country_long);
    if (!country) continue;
    add(countries[country], fuel, capacity, year);
    // Transcontinental countries contribute once to each of their playable regions.
    for (const region of countryRegions.get(country))
      add(regions[region], fuel, capacity, year);
  }
  const result = {
    firstYear: FIRST_YEAR,
    referenceYear: REFERENCE_YEAR,
    source: {
      title: "World Resources Institute Global Power Plant Database v1.3.0",
      url: URL,
      commit: COMMIT,
      sha256: SHA256,
      license: "CC BY 4.0",
      plantCount: rows.length,
    },
    global: finish(global),
    regions: Object.fromEntries(
      Object.entries(regions).map(([region, group]) => [region, finish(group)]),
    ),
    countries: Object.fromEntries(
      Object.entries(countries).map(([country, group]) => [
        country,
        finish(group),
      ]),
    ),
  };
  await fs.writeFile(
    path.join(ROOT, "src/data/StartingFacilityAgeCohorts.json"),
    `${JSON.stringify(result)}\n`,
  );
  const renewables = await renewableSnapshot(
    countryRegions,
    countries,
    regions,
    global,
  );
  await fs.writeFile(
    path.join(ROOT, "src/data/StartingRenewableAges.json"),
    `${JSON.stringify(renewables)}\n`,
  );
  process.stdout.write(
    `Read ${rows.length} plants; wrote ${Object.keys(countries).length} country and ${Object.keys(regions).length} regional age-cohort groups.\n`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
