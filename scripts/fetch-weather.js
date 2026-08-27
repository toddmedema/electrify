#!/usr/bin/env node
/**
 * Downloads a city's weather record from the Open-Meteo ERA5 archive and writes it as the packed
 * binary the game loads. See scripts/cities.json for the catalogue this reads, and
 * src/data/WeatherBinary.tsx for the decoder that has to agree with encodeWeather below.
 *
 * The game only simulates DAYS_PER_MONTH = 1, so a location's 1980-2025 record is twelve days a
 * year: 13,248 hourly readings, 66KB packed. That is also why this fetches one day per
 * month rather than every day - the archive API is billed by location-days, and the
 * days that are never simulated would cost thirty times as much as the ones that are.
 *
 * Rate limits are the binding constraint, not bandwidth. Open-Meteo's free tier allows roughly
 * 600 location-days a minute, 5,000 an hour and 10,000 a day, and one city costs 480 - so a run
 * fetches about ten cities an hour and twenty a day before the API starts refusing. Everything
 * here is built around that: cities are written out as each small batch finishes, an already
 * written city is skipped, and a run that gets cut off by the daily limit stops cleanly and
 * leaves the rest for the next one. Filling all of scripts/cities.json takes a couple of weeks
 * of daily runs, or one run against a key with a higher limit.
 *
 *   node scripts/fetch-weather.js                 # every city that has no data yet
 *   node scripts/fetch-weather.js Tokyo Nairobi   # just these
 *   node scripts/fetch-weather.js --limit 10      # at most ten cities this run
 *   node scripts/fetch-weather.js --force PIT     # refetch one that already has data
 *   node scripts/fetch-weather.js --list          # what is fetched, what is missing
 *   node scripts/update-weather.js                 # extend existing files through last year
 *   node scripts/update-weather.js --through 2030  # extend through a fixed complete year
 */
const fs = require("fs");
const path = require("path");

const CATALOGUE = require("./cities.json");
const OUT_DIR = path.resolve(__dirname, "..", "public", "data", "weather");
const INDEX_FILE = path.join(OUT_DIR, "index.json");
const API = "https://archive-api.open-meteo.com/v1/archive";

// The record every location is expected to have. STARTING_YEAR has to match WEATHER_STARTING_YEAR
// in src/data/Weather.tsx: the game turns a date into a row offset by counting years from it.
const STARTING_YEAR = 1980;
const ENDING_YEAR = 2025;
const MONTHS_PER_YEAR = 12;
const HOURS_PER_DAY = 24;
// Which day of each month stands in for the month. Mid-month is unbiased within the month, and
// no country has ever moved its clocks on the 15th - a day that gains or loses an hour would come
// back with 23 or 25 readings instead of 24.
const SAMPLE_DAY = 15;

// The binary layout, version 1. The scales are written into the header rather than agreed with
// the decoder in a comment, so this file and src/data/WeatherBinary.tsx cannot drift apart.
const MAGIC = "EWX1";
const VERSION = 1;
const HEADER_BYTES = 16;
const BYTES_PER_ROW = 5;
const TEMP_SCALE = 10; // int16 tenths of a degree C
const WIND_SCALE = 2; // uint8 half kph, so up to 127.5kph
const PRECIP_SCALE = 5; // uint8 fifths of a mm, so up to 51mm in an hour

// Locations per request. Purely an efficiency knob: the API charges per location-day either way,
// but twenty locations in one request is twenty times fewer round trips.
const LOCATIONS_PER_REQUEST = 20;
// Cities fetched together and written out together. A batch cut off part way through - which is
// how most runs end, since the daily limit lands wherever it lands - loses whatever it had
// fetched for every city in it, so this is deliberately small. It costs nothing to keep it that
// way: the API bills per location-day whatever the batch size, and even at two locations a
// request the round trips are far below what the rate limit allows to be spent.
const CITIES_PER_BATCH = 2;

// Self-imposed ceilings, a little under what the free tier actually allows, counted in
// location-days. Staying under them is much faster than being told to go away and retry.
const BUDGETS = [
  { windowMs: 60 * 1000, limit: 550 },
  { windowMs: 60 * 60 * 1000, limit: 4800 },
  { windowMs: 24 * 60 * 60 * 1000, limit: 9500 },
];
const RETRY_LIMIT = 5;
// A request that has not answered in this long is treated as lost and made again. Without it a
// socket that dies quietly - a laptop suspending mid-run is the usual way - hangs the whole run
// on a promise that will never settle, several hours from where anyone is watching.
const REQUEST_TIMEOUT_MS = 60 * 1000;

function usage() {
  process.stdout.write(
    fs
      .readFileSync(__filename, "utf8")
      .split("\n")
      .filter((line) => line.startsWith(" *   node"))
      .map((line) => line.replace(" *  ", ""))
      .join("\n") + "\n",
  );
}

const args = process.argv.slice(2);
const options = {
  force: false,
  list: false,
  limit: Infinity,
  ids: [],
  update: false,
  through: ENDING_YEAR,
};
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--help" || arg === "-h") {
    usage();
    process.exit(0);
  } else if (arg === "--force") {
    options.force = true;
  } else if (arg === "--list") {
    options.list = true;
  } else if (arg === "--update") {
    options.update = true;
  } else if (arg === "--through") {
    options.through = Number(args[++i]);
    if (!Number.isInteger(options.through) || options.through < STARTING_YEAR) {
      fail(`--through needs a year no earlier than ${STARTING_YEAR}`);
    }
  } else if (arg === "--limit") {
    options.limit = Number(args[++i]);
    if (!Number.isFinite(options.limit) || options.limit < 1) {
      fail("--limit needs a positive number");
    }
  } else if (arg.startsWith("-")) {
    fail(`Unknown flag ${arg}`);
  } else {
    options.ids.push(arg);
  }
}
if (options.update && options.through >= new Date().getFullYear()) {
  fail("--through must name a fully completed calendar year");
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

/**
 * The name the game shows. State for the United States and Canada, where the city alone is
 * ambiguous and the state is what everyone says anyway, and the country everywhere else.
 */
function displayName(city) {
  return `${city.city}, ${city.admin || city.country}`;
}

function binaryPath(id) {
  return path.join(OUT_DIR, `${id}.bin`);
}

function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  } catch (_e) {
    return { cities: {} };
  }
}

/**
 * Rewrites the index from what is actually on disk.
 *
 * Built by listing the directory rather than by appending to whatever was there before, so a
 * hand-deleted .bin drops out of the picker instead of turning into a 404 on the loading screen.
 */
function writeIndex(fetched, endingYears = {}) {
  const previous = readIndex().cities;
  const cities = {};
  CATALOGUE.cities.forEach((city) => {
    const entry = fetched[city.id] || previous[city.id];
    if (!entry || !fs.existsSync(binaryPath(city.id))) {
      return;
    }
    cities[city.id] = {
      id: city.id,
      name: displayName(city),
      region: city.region,
      country: city.country,
      lat: city.lat,
      long: city.long,
      timeZone: entry.timeZone,
      elevation: entry.elevation,
      startingYear: STARTING_YEAR,
      endingYear: endingYears[city.id] ?? entry.endingYear ?? ENDING_YEAR,
    };
  });
  fs.writeFileSync(
    INDEX_FILE,
    JSON.stringify(
      {
        comment:
          "Generated by scripts/fetch-weather.js - every city the game can actually be played in, being exactly the ones with a .bin beside this file. Do not edit by hand.",
        source: "ERA5 reanalysis via the Open-Meteo Historical Weather API",
        updated: new Date().toISOString().slice(0, 10),
        cities,
      },
      null,
      2,
    ) + "\n",
  );
  return Object.keys(cities).length;
}

// Rolling record of when location-days were spent, so a request can wait rather than be refused
const spent = [];

function budgetWaitMs() {
  const now = Date.now();
  let wait = 0;
  BUDGETS.forEach((budget) => {
    const since = now - budget.windowMs;
    const inWindow = spent.filter((entry) => entry.at > since);
    const used = inWindow.reduce((total, entry) => total + entry.cost, 0);
    if (used >= budget.limit && inWindow.length > 0) {
      wait = Math.max(wait, inWindow[0].at + budget.windowMs - now + 1000);
    }
  });
  return wait;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * How long to wait out a refusal, by which limit was hit. The daily one is not worth waiting for
 * inside a run, so it ends the run instead and the next one picks up the remaining cities.
 */
function backoffMs(reason) {
  if (/daily/i.test(reason)) {
    return null;
  }
  if (/hourly/i.test(reason)) {
    return 10 * 60 * 1000;
  }
  return 65 * 1000;
}

class DailyLimitReached extends Error {}

/**
 * One day of hourly readings for a batch of locations, retried through the API's refusals.
 *
 * timezone=auto is what makes the hours local ones: the game reads row 18 as six in the evening
 * where the player is, and compares it against a sunset it works out from the same zone.
 */
async function fetchDay(batch, year, month) {
  const date = `${year}-${String(month).padStart(2, "0")}-${SAMPLE_DAY}`;
  const url =
    `${API}?latitude=${batch.map((c) => c.lat).join(",")}` +
    `&longitude=${batch.map((c) => c.long).join(",")}` +
    `&start_date=${date}&end_date=${date}` +
    `&hourly=temperature_2m,wind_speed_10m,cloud_cover,precipitation` +
    `&wind_speed_unit=kmh&timezone=auto`;

  for (let attempt = 0; ; attempt++) {
    const wait = budgetWaitMs();
    if (wait > 0) {
      await sleep(wait);
    }
    spent.push({ at: Date.now(), cost: batch.length });
    let response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      if (attempt >= RETRY_LIMIT) {
        throw e;
      }
      await sleep(5000 * (attempt + 1));
      continue;
    }
    const body = await response.text();
    if (response.ok) {
      const parsed = JSON.parse(body);
      // A single location comes back as an object rather than a one-element array
      return Array.isArray(parsed) ? parsed : [parsed];
    }
    if (response.status === 429) {
      const pause = backoffMs(body);
      if (pause === null) {
        throw new DailyLimitReached(
          "Open-Meteo's daily limit is spent; run again tomorrow to continue",
        );
      }
      log(`  rate limited, waiting ${Math.round(pause / 1000)}s`);
      await sleep(pause);
      continue;
    }
    throw new Error(`${response.status} from the archive API: ${body}`);
  }
}

/**
 * Straightens one location's day into exactly 24 readings per field.
 *
 * Two things can be wrong with what comes back. A gap - ERA5 has a few - arrives as null, and is
 * filled from the neighbouring hour rather than being allowed to become a zero, because a zero
 * degree hour in July is a worse lie than a repeated one. And although the 15th never gains or
 * loses an hour to daylight saving, a zone that changed its standard offset on that date
 * historically could still come back short or long, so the day is trimmed or padded to 24.
 */
function readField(hourly, field, cityId, date) {
  const raw = hourly[field];
  if (!raw) {
    throw new Error(`${cityId} ${date}: the API returned no ${field}`);
  }
  const values = [];
  for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
    let value = raw[Math.min(hour, raw.length - 1)];
    if (value === null || value === undefined) {
      value = values.length > 0 ? values[values.length - 1] : null;
    }
    values.push(value);
  }
  // A leading gap can only be filled backwards, once the rest of the day is known
  const firstReal = values.findIndex((v) => v !== null);
  if (firstReal === -1) {
    throw new Error(`${cityId} ${date}: every ${field} reading is missing`);
  }
  for (let hour = 0; hour < firstReal; hour++) {
    values[hour] = values[firstReal];
  }
  return values;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Packs the rows into the file the game downloads: a 16 byte header describing the layout, then
 * one 5 byte row per hour, oldest first.
 *
 * The scales are the whole trick. Temperature keeps a tenth of a degree in an int16 because the
 * demand curve reads it directly; cloud cover is already a percentage; wind lands in half kph
 * steps and precipitation in fifths of a millimetre, both far finer than anything the simulation
 * can tell apart. About 66KB a location through 2025, and no parser on the loading screen.
 */
function encodeWeather(rows, endingYear = ENDING_YEAR) {
  const buffer = Buffer.alloc(HEADER_BYTES + rows.length * BYTES_PER_ROW);
  buffer.write(MAGIC, 0, "ascii");
  buffer.writeUInt8(VERSION, 4);
  buffer.writeUInt8(MONTHS_PER_YEAR, 5); // days per year, one per month
  buffer.writeUInt8(HOURS_PER_DAY, 6);
  buffer.writeUInt8(BYTES_PER_ROW, 7);
  buffer.writeUInt16LE(STARTING_YEAR, 8);
  buffer.writeUInt16LE(endingYear - STARTING_YEAR + 1, 10);
  buffer.writeUInt8(TEMP_SCALE, 12);
  buffer.writeUInt8(WIND_SCALE, 13);
  buffer.writeUInt8(PRECIP_SCALE, 14);
  buffer.writeUInt8(0, 15); // reserved

  rows.forEach((row, index) => {
    const at = HEADER_BYTES + index * BYTES_PER_ROW;
    buffer.writeInt16LE(
      clamp(Math.round(row.tempC * TEMP_SCALE), -32768, 32767),
      at,
    );
    buffer.writeUInt8(clamp(Math.round(row.cloudPct), 0, 100), at + 2);
    buffer.writeUInt8(
      clamp(Math.round(row.windKph * WIND_SCALE), 0, 255),
      at + 3,
    );
    buffer.writeUInt8(
      clamp(Math.round(row.precipMm * PRECIP_SCALE), 0, 255),
      at + 4,
    );
  });
  return buffer;
}

/**
 * Fetches one batch of cities together, a day at a time across all of them.
 *
 * Batching this way rather than city by city is what keeps the request count down: one request
 * carries the same calendar day for every city in the batch.
 */
async function fetchBatch(
  batch,
  firstYear = STARTING_YEAR,
  lastYear = ENDING_YEAR,
) {
  const rows = new Map(batch.map((city) => [city.id, []]));
  const meta = new Map();

  for (let year = firstYear; year <= lastYear; year++) {
    for (let month = 1; month <= MONTHS_PER_YEAR; month++) {
      for (let at = 0; at < batch.length; at += LOCATIONS_PER_REQUEST) {
        const slice = batch.slice(at, at + LOCATIONS_PER_REQUEST);
        const results = await fetchDay(slice, year, month);
        if (results.length !== slice.length) {
          throw new Error(
            `Asked for ${slice.length} locations and got ${results.length} back`,
          );
        }
        slice.forEach((city, index) => {
          const result = results[index];
          const date = `${year}-${month}`;
          const temp = readField(
            result.hourly,
            "temperature_2m",
            city.id,
            date,
          );
          const wind = readField(
            result.hourly,
            "wind_speed_10m",
            city.id,
            date,
          );
          const cloud = readField(result.hourly, "cloud_cover", city.id, date);
          const precip = readField(
            result.hourly,
            "precipitation",
            city.id,
            date,
          );
          for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
            rows.get(city.id).push({
              tempC: temp[hour],
              windKph: wind[hour],
              cloudPct: cloud[hour],
              precipMm: precip[hour],
            });
          }
          if (!meta.has(city.id)) {
            meta.set(city.id, {
              timeZone: result.timezone,
              elevation: result.elevation,
            });
          }
        });
      }
    }
    if ((year - firstYear + 1) % 10 === 0 || year === lastYear) {
      log(`  through ${year}`);
    }
  }
  return { rows, meta };
}

function readPackedWeather(city) {
  const file = fs.readFileSync(binaryPath(city.id));
  if (file.length < HEADER_BYTES || file.toString("ascii", 0, 4) !== MAGIC) {
    throw new Error(`${city.id}: existing file is not ${MAGIC} weather data`);
  }
  const version = file.readUInt8(4);
  const months = file.readUInt8(5);
  const hours = file.readUInt8(6);
  const bytesPerRow = file.readUInt8(7);
  const startingYear = file.readUInt16LE(8);
  const yearCount = file.readUInt16LE(10);
  if (
    version !== VERSION ||
    months !== MONTHS_PER_YEAR ||
    hours !== HOURS_PER_DAY ||
    bytesPerRow !== BYTES_PER_ROW ||
    startingYear !== STARTING_YEAR ||
    file.readUInt8(12) !== TEMP_SCALE ||
    file.readUInt8(13) !== WIND_SCALE ||
    file.readUInt8(14) !== PRECIP_SCALE
  ) {
    throw new Error(
      `${city.id}: existing weather layout is incompatible with this updater`,
    );
  }
  const expectedBytes =
    HEADER_BYTES + yearCount * MONTHS_PER_YEAR * HOURS_PER_DAY * BYTES_PER_ROW;
  if (file.length !== expectedBytes) {
    throw new Error(
      `${city.id}: existing file has ${file.length} bytes; its header describes ${expectedBytes}`,
    );
  }
  return { file, endingYear: startingYear + yearCount - 1 };
}

function extendPackedWeather(existing, newRows, endingYear) {
  const added = encodeWeather(newRows, endingYear).subarray(HEADER_BYTES);
  const extended = Buffer.concat([
    existing.subarray(0, HEADER_BYTES),
    existing.subarray(HEADER_BYTES),
    added,
  ]);
  extended.writeUInt16LE(endingYear - STARTING_YEAR + 1, 10);
  return extended;
}

async function updateExisting(catalogue) {
  const existing = catalogue
    .filter((city) => fs.existsSync(binaryPath(city.id)))
    .map((city) => ({ city, ...readPackedWeather(city) }))
    .filter((entry) => entry.endingYear < options.through)
    .filter(
      (entry) =>
        options.ids.length === 0 || options.ids.includes(entry.city.id),
    )
    .slice(0, options.limit);

  if (existing.length === 0) {
    log(
      `Nothing to update: requested weather files already run through ${options.through}`,
    );
    return;
  }

  const groups = new Map();
  existing.forEach((entry) => {
    const firstYear = entry.endingYear + 1;
    if (!groups.has(firstYear)) groups.set(firstYear, []);
    groups.get(firstYear).push(entry);
  });
  const locationDays = existing.reduce(
    (total, entry) =>
      total + (options.through - entry.endingYear) * MONTHS_PER_YEAR,
    0,
  );
  log(
    `Updating ${existing.length} existing cities through ${options.through} ` +
      `(${locationDays} location-days).`,
  );

  const fetched = {};
  const endingYears = {};
  let done = 0;
  try {
    for (const [firstYear, entries] of groups) {
      for (let at = 0; at < entries.length; at += CITIES_PER_BATCH) {
        const batch = entries.slice(at, at + CITIES_PER_BATCH);
        const cities = batch.map((entry) => entry.city);
        log(
          `\n${cities.map((city) => city.id).join(", ")} (${firstYear}-${options.through})`,
        );
        const { rows, meta } = await fetchBatch(
          cities,
          firstYear,
          options.through,
        );
        batch.forEach((entry) => {
          const cityRows = rows.get(entry.city.id);
          fs.writeFileSync(
            binaryPath(entry.city.id),
            extendPackedWeather(entry.file, cityRows, options.through),
          );
          fetched[entry.city.id] = meta.get(entry.city.id);
          endingYears[entry.city.id] = options.through;
          done++;
          log(
            `  ${entry.city.id}: added ${summarise(entry.city.id, cityRows)}`,
          );
        });
        writeIndex(fetched, endingYears);
      }
    }
  } catch (e) {
    writeIndex(fetched, endingYears);
    if (e instanceof DailyLimitReached) {
      log(`\n${e.message}`);
    } else {
      process.stderr.write(`\n${e.stack || e.message}\n`);
      process.exitCode = 1;
    }
  }
  log(`\nUpdated ${done} cities through ${options.through}`);
}

/**
 * A quick look at what came back, printed per city, because a silently wrong location is the
 * failure that would survive every check here: coordinates a degree out still return a perfectly
 * well formed multi-decade record of somewhere else.
 */
function summarise(id, rows) {
  const mean = (field) =>
    rows.reduce((total, row) => total + row[field], 0) / rows.length;
  const januaries = rows.filter(
    (_row, index) => Math.floor(index / HOURS_PER_DAY) % MONTHS_PER_YEAR === 0,
  );
  const julies = rows.filter(
    (_row, index) => Math.floor(index / HOURS_PER_DAY) % MONTHS_PER_YEAR === 6,
  );
  const janMean = januaries.reduce((t, r) => t + r.tempC, 0) / januaries.length;
  const julMean = julies.reduce((t, r) => t + r.tempC, 0) / julies.length;
  return (
    `${rows.length} rows, ${mean("tempC").toFixed(1)}C ` +
    `(Jan ${janMean.toFixed(1)}, Jul ${julMean.toFixed(1)}), ` +
    `${mean("windKph").toFixed(1)}kph, ${mean("cloudPct").toFixed(0)}% cloud, ` +
    `${(mean("precipMm") * 24 * 365).toFixed(0)}mm/yr`
  );
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const catalogue = CATALOGUE.cities;
  const byId = new Map(catalogue.map((city) => [city.id, city]));

  options.ids.forEach((id) => {
    if (!byId.has(id)) {
      fail(`"${id}" is not in scripts/cities.json`);
    }
  });

  if (options.update) {
    await updateExisting(catalogue);
    return;
  }

  const have = new Set(
    catalogue
      .filter((city) => fs.existsSync(binaryPath(city.id)))
      .map((c) => c.id),
  );

  if (options.list) {
    log(`${have.size} of ${catalogue.length} cities have weather data`);
    catalogue.forEach((city) => {
      log(
        `  ${have.has(city.id) ? "x" : " "} ${city.id} - ${displayName(city)}`,
      );
    });
    return;
  }

  const wanted = (
    options.ids.length > 0 ? options.ids.map((id) => byId.get(id)) : catalogue
  )
    .filter((city) => options.force || !have.has(city.id))
    .slice(0, options.limit);

  if (wanted.length === 0) {
    log(
      `Nothing to fetch: all ${have.size} requested cities already have data (--force to refetch)`,
    );
    return;
  }

  const perCity = (ENDING_YEAR - STARTING_YEAR + 1) * MONTHS_PER_YEAR;
  log(
    `Fetching ${wanted.length} cities, ${perCity} location-days each. ` +
      `The free tier allows about ten cities an hour.`,
  );

  const fetched = {};
  let done = 0;
  try {
    for (let at = 0; at < wanted.length; at += CITIES_PER_BATCH) {
      const batch = wanted.slice(at, at + CITIES_PER_BATCH);
      log(`\n${batch.map((c) => c.id).join(", ")}`);
      const { rows, meta } = await fetchBatch(batch);
      batch.forEach((city) => {
        const cityRows = rows.get(city.id);
        fs.writeFileSync(binaryPath(city.id), encodeWeather(cityRows));
        fetched[city.id] = meta.get(city.id);
        done++;
        log(
          `  ${city.id} (${meta.get(city.id).timeZone}): ${summarise(city.id, cityRows)}`,
        );
      });
      writeIndex(fetched);
    }
  } catch (e) {
    writeIndex(fetched);
    if (e instanceof DailyLimitReached) {
      log(`\n${e.message}`);
    } else {
      process.stderr.write(`\n${e.stack || e.message}\n`);
      process.exitCode = 1;
    }
  }

  const total = writeIndex(fetched);
  log(`\nWrote ${done} cities; ${total} of ${catalogue.length} now playable`);
}

main();
