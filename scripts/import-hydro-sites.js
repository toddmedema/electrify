const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
// Offline, deterministic conversion of the issue research plus JRC's technology cross-check.
// See docs/hydro-sites.md for pinned inputs, provenance, exclusions, and coverage limits.
const [researchPath, jrcPath] = process.argv.slice(2);
if (!researchPath || !jrcPath)
  throw new Error(
    "Usage: node scripts/import-hydro-sites.js <hydro_site_catalogue.json> <jrc-hydro-power-plant-database.csv>",
  );
const read = (file) =>
  fs
    .readFileSync(file, "utf8")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .trim();
const input = JSON.parse(read(researchPath));
const csvRows = (text) => {
  const rows = [];
  let row = [],
    value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(value);
      value = "";
      if (c === "\n") {
        rows.push(row);
        row = [];
      }
    } else value += c;
  }
  row.push(value);
  rows.push(row);
  const headers = rows.shift();
  return rows.map((values) =>
    Object.fromEntries(headers.map((key, i) => [key, values[i]])),
  );
};
const jrc = csvRows(read(jrcPath));
const cities = JSON.parse(read(path.join(__dirname, "cities.json"))).cities;
const jrcVersion = "3e8a8378289679073208b39825a99de5ab8b05f5";
const jrcUrl = `https://github.com/energy-modelling-toolkit/hydro-power-database/blob/${jrcVersion}/data/jrc-hydro-power-plant-database.csv`;
const accessed = "2026-09-22";
const distance = (a, b) => {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((a.lat - b.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(((a.lon - b.lon) * rad) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
};
const words = (s) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];
const generic = new Set([
  "hydro",
  "power",
  "plant",
  "station",
  "central",
  "centrale",
  "kraftwerk",
  "hydroelectric",
  "storage",
  "pumped",
  "river",
]);
const nameMatches = (a, b) =>
  words(a).some(
    (word) => word.length >= 5 && !generic.has(word) && words(b).includes(word),
  );
const reviewed = new Set([
  "kariba-zmb",
  "kafue-gorge-zmb",
  "victoria-falls-zmb",
  "azutan-2-esp",
]);
// GPPD rows with known physical-site or technology ambiguity are not promoted to gameplay.
const exclusions = new Set([
  "karlshamn-swe",
  "laufenburg-che",
  "fionnay-che",
  "malta-main-stage-aut",
  "aurland5-nor",
  "valdecanas-3-esp",
  "torrejon-1-esp",
]);
const candidates = [];
for (const [id, site] of Object.entries(input.sites)) {
  if (exclusions.has(id)) continue;
  const originalValue = parseFloat(site.originalValue);
  if (
    !Number.isFinite(originalValue) ||
    Math.round(originalValue * 1e6) !== site.maxPeakW ||
    site.maxPeakW < 1e6 ||
    !Number.isSafeInteger(site.maxPeakW) ||
    !Number.isFinite(site.lat) ||
    !Number.isFinite(site.lon) ||
    Math.abs(site.lat) > 90 ||
    Math.abs(site.lon) > 180
  )
    throw new Error(`Invalid source site: ${id}`);
  let evidence;
  if (site.country === "USA" && site.source.includes("prime mover HY"))
    evidence =
      "EIA HY classification; plant-level conventional nameplate only.";
  else if (reviewed.has(id))
    evidence =
      id === "azutan-2-esp"
        ? "Conventional Azutan dam corroborated by Iberdrola Tagus-basin description and JRC H272; retain REE/GPPD 198.01 MW nameplate rather than JRC 180 MW older figure."
        : "ZESCO generation catalogue corroborates the physical dam and conventional technology. Kariba combines both national powerhouses at one dam; retain the cited GPPD vintage, not a year-dependent ceiling.";
  else {
    const nearby = jrc.filter(
      (row) =>
        Number.isFinite(Number(row.lat)) &&
        distance(site, { lat: Number(row.lat), lon: Number(row.lon) }) <= 2 &&
        nameMatches(site.name, row.name),
    );
    if (nearby.length !== 1) continue;
    const row = nearby[0];
    const capacity = Number(row.installed_capacity_MW);
    if (
      !["HDAM", "HROR"].includes(row.type) ||
      Number(row.pumping_MW) > 0 ||
      Math.abs(capacity - originalValue) > Math.max(0.01, originalValue * 0.05)
    )
      continue;
    if (
      /bundle|complex|cascade|\(.*-.*\)/i.test(site.name) ||
      /bundle|complex|cascade/i.test(row.name)
    )
      continue;
    evidence = `JRC ${row.id} corroborates conventional technology, name, coordinates within 2 km and capacity within 5%; retain cited GPPD capacity. JRC ${capacity} MW. ${jrcUrl}`;
  }
  candidates.push({
    id,
    name: site.name,
    maxPeakW: Number(site.maxPeakW.toPrecision(1)),
    lat: site.lat,
    lon: site.lon,
    source: site.source,
    sourceUrl: site.sourceUrl,
    accessed,
    datasetVersion: site.country === "USA" ? "EIA-860M 2026-07" : "GPPD 1.3.0",
    originalValue,
    originalUnit: "MW",
    notes: [site.note, evidence].filter(Boolean).join(" "),
  });
}
// Quarantine collocated records rather than creating two claims at a possibly shared dam.
// A conservative partial inventory is preferable to inventing a sum of duplicate records.
const collocated = new Set();
for (let i = 0; i < candidates.length; i++)
  for (let j = i + 1; j < candidates.length; j++)
    if (distance(candidates[i], candidates[j]) < 0.15) {
      collocated.add(candidates[i].id);
      collocated.add(candidates[j].id);
    }
const sites = candidates
  .filter((s) => !collocated.has(s.id))
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const inventories = {};
for (const city of cities) {
  const point = { lat: city.lat, lon: city.long };
  const siteIds = sites
    .filter((s) => s.originalValue >= 10 && distance(point, s) <= 250)
    .map((s) => s.id);
  const originalIds = input.locations[city.id]?.siteIds;
  if (!originalIds) throw new Error(`Missing research disposition: ${city.id}`);
  const inEiaCoverage = city.country === "United States" && city.id !== "SJU";
  const status =
    sites.some((s) => distance(point, s) <= 250) || inEiaCoverage
      ? "researched"
      : "unresearched";
  inventories[city.id] = {
    status,
    locationLat: city.lat,
    locationLong: city.long,
    siteIds,
    researchDisposition: `Reviewed issue #417 GPPD/EIA candidate inventory (${originalIds.length} records), plus JRC conventional cross-check; ${siteIds.length} qualifying verified sites within 250 km. ${inEiaCoverage ? "EIA coverage: US conventional HY units >=1 MW; excludes non-powered-dam potential and cross-border projects without corroboration." : status === "researched" ? "Partial source coverage only: EIA US plants, JRC-correlated European plants and individually reviewed Zambian sites. Remaining GPPD records lack corroborated technology, capacity or physical-site identity; omitted pending source resolution." : "Source gap: GPPD Hydro does not identify pumped storage and includes aggregate/mislocated records; no candidate passed the conventional physical-site corroboration method. This is unavailable research, not a zero-potential finding."}`,
  };
}
inventories["scenario:114"] = {
  status: "researched",
  authoredScenarioId: 114,
  locationId: "Lusaka",
  siteIds: [...inventories.Lusaka.siteIds, "victoria-falls-zmb"],
  researchDisposition:
    "Authored Zambia national-grid exception: scenario 114 explicitly models Kariba, Kafue Gorge and Victoria Falls. Victoria Falls is outside the ordinary 250 km radius; ZESCO generation catalogue corroborates its 108 MW ceiling. This exception never widens custom Lusaka games.",
};
const used = new Set(Object.values(inventories).flatMap((i) => i.siteIds));
const output = {
  metadata: {
    accessed,
    radiusKm: 250,
    minimumPeakW: 10000000,
    researchRevision: "d102fef109030842710643c979f171ef67d014e1",
    jrcVersion,
    inputHashes: {
      research: crypto
        .createHash("sha256")
        .update(read(researchPath))
        .digest("hex"),
      jrc: crypto.createHash("sha256").update(read(jrcPath)).digest("hex"),
    },
    methodology: "docs/hydro-sites.md",
    collocatedRecordsExcluded: [...collocated].sort(),
  },
  sites: sites.filter((s) => used.has(s.id)),
  inventories,
};
fs.writeFileSync(
  path.join(__dirname, "../src/data/HydroSiteCatalogue.json"),
  JSON.stringify(output, null, 2) + "\n",
);
const lines = [
  "# Hydro research disposition by location",
  "",
  "Generated by `scripts/import-hydro-sites.js`. All 285 authored city records were reviewed against the issue catalogue. Counts describe a partial, corroborated inventory, never a complete potential estimate. See [methodology](hydro-sites.md).",
  "",
  "| Location | Status | Sites | Reviewed candidates | Source disposition |",
  "| --- | --- | ---: | ---: | --- |",
];
for (const city of cities) {
  const i = inventories[city.id];
  lines.push(
    `| ${city.id} | ${i.status} | ${i.siteIds.length} | ${input.locations[city.id].siteIds.length} | ${i.researchDisposition} |`,
  );
}
fs.writeFileSync(
  path.join(__dirname, "../docs/hydro-site-coverage.md"),
  lines.join("\n") + "\n",
);
process.stdout.write(
  JSON.stringify({
    sites: output.sites.length,
    researched: Object.values(inventories).filter(
      (i) => i.status === "researched",
    ).length,
    locations: cities.length,
    collocated: collocated.size,
  }) + "\n",
);
