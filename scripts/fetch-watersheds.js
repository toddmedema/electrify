#!/usr/bin/env node
/**
 * Fetches the two curated upstream hydro basins from NASA POWER's monthly archive and
 * writes them in the same packed format as city weather. The main weather fetcher intentionally
 * downloads one representative day per month to stay inside Open-Meteo's quota. Reservoirs need
 * a monthly precipitation total, not one date multiplied into a month, so these basin-only files
 * use POWER's monthly mean precipitation rate instead. POWER wind and surface-solar series also
 * keep a watershed that is itself playable (Echo Summit) from having placeholder weather.
 *
 * MERRA-2 starts in 1981. The game record starts in 1980, so 1980 repeats 1981's climatology; all
 * later months are their own observations. Basin rows hold monthly mean temperature in every hour
 * and the mean day's precipitation in hour zero. helpers/Hydro expands that representative day
 * to the full month, yielding POWER's monthly total.
 */
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.resolve(__dirname, "..", "public", "data", "weather");
const API = "https://power.larc.nasa.gov/api/temporal/monthly/point";
const STARTING_YEAR = 1980;
const SOURCE_STARTING_YEAR = 1981;
const ENDING_YEAR = 2019;
const HOURS_PER_DAY = 24;
const MONTHS_PER_YEAR = 12;
const MAGIC = "EWX1";
const VERSION = 2;
const HEADER_BYTES = 16;
const BYTES_PER_ROW = 5;
const TEMP_SCALE = 10;
const WIND_SCALE = 2;
const PRECIP_SCALE = 5;

const WATERSHEDS = [
  {
    id: "CAMountains",
    name: "Sierra Nevada watershed at Echo Summit",
    lat: 38.93,
    long: -120.03,
  },
  {
    id: "AlleghenyUpper",
    name: "Upper Allegheny watershed",
    lat: 41.9,
    long: -78.9,
  },
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function fetchWatershed(watershed) {
  const params = new URLSearchParams({
    parameters:
      "T2M,PRECTOTCORR,WS2M,ALLSKY_SFC_SW_DWN,CLRSKY_SFC_SW_DWN",
    community: "RE",
    longitude: String(watershed.long),
    latitude: String(watershed.lat),
    start: String(SOURCE_STARTING_YEAR),
    end: String(ENDING_YEAR),
    format: "JSON",
  });
  const response = await fetch(`${API}?${params}`);
  if (!response.ok) {
    throw new Error(`${response.status} fetching ${watershed.id}`);
  }
  const body = await response.json();
  const temperature = body.properties?.parameter?.T2M;
  const precipitation = body.properties?.parameter?.PRECTOTCORR;
  const wind = body.properties?.parameter?.WS2M;
  const allSkySolar = body.properties?.parameter?.ALLSKY_SFC_SW_DWN;
  const clearSkySolar = body.properties?.parameter?.CLRSKY_SFC_SW_DWN;
  if (!temperature || !precipitation || !wind || !allSkySolar || !clearSkySolar) {
    throw new Error(`${watershed.id} response is missing a requested weather series`);
  }
  return { temperature, precipitation, wind, allSkySolar, clearSkySolar };
}

function encode(watershed, source) {
  const rowCount =
    (ENDING_YEAR - STARTING_YEAR + 1) * MONTHS_PER_YEAR * HOURS_PER_DAY;
  const buffer = Buffer.alloc(HEADER_BYTES + rowCount * BYTES_PER_ROW);
  buffer.write(MAGIC, 0, "ascii");
  buffer.writeUInt8(VERSION, 4);
  buffer.writeUInt8(MONTHS_PER_YEAR, 5);
  buffer.writeUInt8(HOURS_PER_DAY, 6);
  buffer.writeUInt8(BYTES_PER_ROW, 7);
  buffer.writeUInt16LE(STARTING_YEAR, 8);
  buffer.writeUInt16LE(ENDING_YEAR - STARTING_YEAR + 1, 10);
  buffer.writeUInt8(TEMP_SCALE, 12);
  buffer.writeUInt8(WIND_SCALE, 13);
  buffer.writeUInt8(PRECIP_SCALE, 14);
  buffer.writeUInt8(0, 15);

  let at = HEADER_BYTES;
  for (let year = STARTING_YEAR; year <= ENDING_YEAR; year++) {
    const sourceYear = Math.max(SOURCE_STARTING_YEAR, year);
    for (let month = 1; month <= MONTHS_PER_YEAR; month++) {
      const key = `${sourceYear}${String(month).padStart(2, "0")}`;
      const temperatureC = source.temperature[key];
      const precipitationMmPerDay = source.precipitation[key];
      const windKph = source.wind[key] * 3.6;
      const cloudPct =
        100 * (1 - source.allSkySolar[key] / source.clearSkySolar[key]);
      if (
        !Number.isFinite(temperatureC) ||
        !Number.isFinite(precipitationMmPerDay) ||
        !Number.isFinite(windKph) ||
        !Number.isFinite(cloudPct)
      ) {
        throw new Error(`${watershed.id} has no finite values for ${key}`);
      }
      for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
        buffer.writeInt16LE(
          clamp(Math.round(temperatureC * TEMP_SCALE), -32768, 32767),
          at,
        );
        buffer.writeUInt8(clamp(Math.round(cloudPct), 0, 100), at + 2);
        buffer.writeUInt8(
          clamp(Math.round(windKph * WIND_SCALE), 0, 255),
          at + 3,
        );
        buffer.writeUInt8(
          hour === 0
            ? clamp(Math.round(precipitationMmPerDay * PRECIP_SCALE), 0, 255)
            : 0,
          at + 4,
        );
        at += BYTES_PER_ROW;
      }
    }
  }
  const file = path.join(OUT_DIR, `${watershed.id}.bin`);
  fs.writeFileSync(file, buffer);
  process.stdout.write(
    `${watershed.id}: ${rowCount} rows from NASA POWER monthly data -> ${file}\n`,
  );
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const watershed of WATERSHEDS) {
    encode(watershed, await fetchWatershed(watershed));
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
