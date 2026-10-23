// Node 24. Rebuild the US state age cohorts from the pinned public EIA-860 inventory.
// Usage: node scripts/research-us-starting-facility-ages.js [path/to/eia8602024.zip]
// The source download is cached under .tmp, outside the checked-in snapshot.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { inflateRawSync } = require("node:zlib");

const ROOT = path.resolve(__dirname, "..");
const URL =
  "https://www.eia.gov/electricity/data/eia860/archive/xls/eia8602024.zip";
const SHA256 =
  "0aaae04812cd4ab87a3e346bdf93848a3cc15053fd4dc2a4cf82d2aeac95f12b";

// EIA's workbook is a standard ZIP of XML files. Only stored/deflated entries
// and the ordinary worksheet cell forms used by this pinned workbook are needed.
function unzip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("ZIP central directory is missing");
  const files = new Map();
  let offset = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < buffer.readUInt16LE(end + 10); index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("Invalid ZIP central directory entry");
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    const local = buffer.readUInt32LE(offset + 42);
    const start =
      local +
      30 +
      buffer.readUInt16LE(local + 26) +
      buffer.readUInt16LE(local + 28);
    const compressed = buffer.subarray(start, start + size);
    if (method !== 0 && method !== 8)
      throw new Error(`Unsupported ZIP compression ${method}`);
    files.set(name, () =>
      method === 8 ? inflateRawSync(compressed) : compressed,
    );
    offset +=
      46 +
      nameLength +
      buffer.readUInt16LE(offset + 30) +
      buffer.readUInt16LE(offset + 32);
  }
  return files;
}

const decode = (value) =>
  value.replace(
    /&(?:amp|lt|gt|quot|apos);/g,
    (entity) =>
      ({
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
      })[entity],
  );

function rowsFromWorkbook(buffer) {
  const files = unzip(buffer);
  const strings = [
    ...files
      .get("xl/sharedStrings.xml")()
      .toString()
      .matchAll(/<si>([\s\S]*?)<\/si>/g),
  ].map(([, value]) =>
    [...value.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map(([, text]) => decode(text))
      .join(""),
  );
  const worksheet = files.get("xl/worksheets/sheet1.xml")().toString();
  return [...worksheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(
    ([, xml]) => {
      const row = [];
      for (const [, attributes, inner] of xml.matchAll(
        /<c\b([^>]*)>([\s\S]*?)<\/c>/g,
      )) {
        const column = attributes.match(/\br="([A-Z]+)\d+"/)[1];
        const index =
          [...column].reduce(
            (sum, letter) => sum * 26 + letter.charCodeAt(0) - 64,
            0,
          ) - 1;
        const value = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        row[index] = attributes.includes('t="s"')
          ? strings[Number(value)]
          : value;
      }
      return row;
    },
  );
}

const FUEL_CODES = {
  Coal: ["ANT", "BIT", "LIG", "RC", "SGC", "SUB", "WC"],
  "Natural Gas": ["NG"],
  Oil: ["DFO", "JF", "KER", "PC", "RFO", "SGP", "WO"],
  Uranium: ["NUC"],
  Hydro: ["WAT"],
  Sun: ["SUN"],
  Wind: ["WND"],
  Biomass: [
    "AB",
    "BLQ",
    "LFG",
    "MSB",
    "OBG",
    "OBL",
    "OBS",
    "SLW",
    "WDL",
    "WDS",
  ],
  Geothermal: ["GEO"],
};

async function main() {
  const cached = path.join(
    ROOT,
    ".tmp",
    "starting-age-research",
    "eia8602024.zip",
  );
  const input = process.argv[2] || cached;
  if (!fs.existsSync(input)) {
    const response = await fetch(URL);
    if (!response.ok) throw new Error(`EIA download: HTTP ${response.status}`);
    fs.mkdirSync(path.dirname(input), { recursive: true });
    fs.writeFileSync(input, Buffer.from(await response.arrayBuffer()));
  }
  const buffer = fs.readFileSync(input);
  if (createHash("sha256").update(buffer).digest("hex") !== SHA256)
    throw new Error(
      "EIA source changed; review it before changing the pinned digest",
    );
  const rows = rowsFromWorkbook(
    unzip(buffer).get("3_1_Generator_Y2024.xlsx")(),
  );
  const headerIndex = rows.findIndex((row) => row.includes("Operating Year"));
  if (headerIndex < 0) throw new Error("EIA generator header is missing");
  const headers = rows[headerIndex];
  const column = (label) => {
    const index = headers.indexOf(label);
    if (index < 0) throw new Error(`EIA column is missing: ${label}`);
    return index;
  };
  const locations = Object.values(
    JSON.parse(
      fs.readFileSync(path.join(ROOT, "public/data/weather/index.json")),
    ).cities,
  );
  const supported = new Set(
    locations
      .filter((location) => location.country === "United States")
      .map((location) => location.admin),
  );
  const states = Object.fromEntries(
    [...supported]
      .filter((code) => code.length === 2)
      .sort()
      .map((code) => [code, {}]),
  );
  const indices = Object.fromEntries(
    [
      "State",
      "Status",
      "Nameplate Capacity (MW)",
      "Operating Year",
      "Energy Source 1",
      "Prime Mover",
    ].map((label) => [label, column(label)]),
  );
  const add = (state, fuel, capacity, year) => {
    const cohort = (states[state][fuel] ||= {
      capacityMW: 0,
      knownCapacityMW: 0,
      years: {},
    });
    cohort.capacityMW += capacity;
    if (year >= 1850 && year <= 2024) {
      cohort.knownCapacityMW += capacity;
      cohort.years[year] = (cohort.years[year] || 0) + capacity;
    }
  };
  for (const row of rows.slice(headerIndex + 1)) {
    const state = row[indices.State];
    if (!states[state] || !["OP", "SB", "OS"].includes(row[indices.Status]))
      continue;
    const capacity = Number(row[indices["Nameplate Capacity (MW)"]]);
    if (!(capacity > 0)) continue;
    const code = row[indices["Energy Source 1"]];
    const fuel = Object.keys(FUEL_CODES).find((fuel) =>
      FUEL_CODES[fuel].includes(code),
    );
    if (!fuel || (fuel === "Hydro" && row[indices["Prime Mover"]] === "PS"))
      continue;
    const year = Number(row[indices["Operating Year"]]);
    add(state, fuel, capacity, year);
    if (fuel === "Natural Gas") {
      const mover = row[indices["Prime Mover"]];
      if (["CA", "CC", "CS"].includes(mover))
        add(state, "Natural Gas CC", capacity, year);
      if (["GT", "IC"].includes(mover))
        add(state, "Natural Gas Peaker", capacity, year);
    }
  }
  for (const cohorts of Object.values(states)) {
    for (const value of Object.values(cohorts)) {
      value.capacityMW = Math.round(value.capacityMW * 100) / 100;
      value.knownCapacityMW = Math.round(value.knownCapacityMW * 100) / 100;
      const years = Object.entries(value.years).map(([year, capacity]) => [
        Number(year),
        capacity,
      ]);
      value.ages = Array.from({ length: 15 }, (_, index) => {
        const startingYear = 2010 + index;
        const eligible = years.filter(([year]) => year < startingYear);
        const totalMW = eligible.reduce(
          (sum, [, capacity]) => sum + capacity,
          0,
        );
        return totalMW > 0
          ? Math.max(
              1,
              Math.round(
                eligible.reduce(
                  (sum, [year, capacity]) =>
                    sum + (startingYear - year) * capacity,
                  0,
                ) / totalMW,
              ),
            )
          : null;
      });
      delete value.years;
    }
  }
  const snapshot = {
    firstYear: 2010,
    referenceYear: 2024,
    source: {
      title:
        "U.S. Energy Information Administration, Form EIA-860, 2024 operable generators",
      url: URL,
      sha256: SHA256,
    },
    states,
  };
  fs.writeFileSync(
    path.join(ROOT, "src/data/StartingFacilityAgeStates.json"),
    `${JSON.stringify(snapshot, null, 2)}\n`,
  );
  process.stdout.write(
    `Wrote commissioning cohorts for ${Object.keys(states).length} supported US states.\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
