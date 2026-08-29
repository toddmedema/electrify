import { RawWeatherType } from "../Types";

/**
 * Reader for the packed weather files in public/data/weather, written by scripts/fetch-weather.js.
 *
 * A location's whole record is twelve days a year for forty years - 11,520 hourly readings - and
 * as CSV that was 265KB of text to download and parse before the first frame of a game. Packed it
 * is 57KB (69KB with offshore wind) and a single pass over a DataView, which is what makes
 * shipping hundreds of cities affordable rather than a megabyte apiece.
 *
 * The layout is deliberately self-describing: the header carries the scale each field was
 * quantised with, so this file and the fetch script cannot quietly disagree about whether wind is
 * in whole kph or half kph. Anything that doesn't parse throws rather than returning a plausible
 * looking array of zeroes, because forty years of 0C is a game that runs and is simply wrong.
 */

const MAGIC = "EWX1";
const SUPPORTED_VERSIONS = [1, 2];
const HEADER_BYTES = 16;
const BASE_BYTES_PER_ROW = 5;
const OFFSHORE_BYTES_PER_ROW = 6;
const FLAG_OFFSHORE_WIND = 1;
// decodeWeather works out which month a row belongs to from its position -- one recorded day per
// calendar month -- so a file claiming more days than a year has months would number rows MONTH
// 13 and up, which is not a month and which every reader of RawWeatherType would go on to
// believe. The decoder is otherwise happy at any smaller shape, which is what its tests use.
const MAX_DAYS_PER_YEAR = 12;

export interface WeatherFileHeaderType {
  version: number;
  daysPerYear: number;
  hoursPerDay: number;
  startingYear: number;
  yearCount: number;
  rowCount: number;
  offshore: boolean;
}

function readHeader(view: DataView, byteLength: number): WeatherFileHeaderType {
  if (byteLength < HEADER_BYTES) {
    throw new Error(`Weather file is ${byteLength} bytes, too short to be one`);
  }
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  if (magic !== MAGIC) {
    throw new Error(`Weather file does not start with ${MAGIC}`);
  }
  const version = view.getUint8(4);
  if (!SUPPORTED_VERSIONS.includes(version)) {
    throw new Error(
      `Weather file is version ${version}, and this build reads versions ${SUPPORTED_VERSIONS.join(" and ")}`,
    );
  }
  const bytesPerRow = view.getUint8(7);
  const flags = version >= 2 ? view.getUint8(15) : 0;
  const offshore = (flags & FLAG_OFFSHORE_WIND) !== 0;
  const expectedBytesPerRow = offshore
    ? OFFSHORE_BYTES_PER_ROW
    : BASE_BYTES_PER_ROW;
  if (bytesPerRow !== expectedBytesPerRow) {
    throw new Error(
      `Weather file has ${bytesPerRow} byte rows, but its header describes ${expectedBytesPerRow}`,
    );
  }
  const header = {
    version,
    daysPerYear: view.getUint8(5),
    hoursPerDay: view.getUint8(6),
    startingYear: view.getUint16(8, true),
    yearCount: view.getUint16(10, true),
    rowCount: Math.floor((byteLength - HEADER_BYTES) / bytesPerRow),
    offshore,
  };
  if (header.daysPerYear < 1 || header.daysPerYear > MAX_DAYS_PER_YEAR) {
    throw new Error(
      `Weather file holds ${header.daysPerYear} days a year, and a day has to be a month of the ${MAX_DAYS_PER_YEAR} in one`,
    );
  }
  if (header.hoursPerDay < 1) {
    throw new Error("Weather file holds no hours a day");
  }
  const bodyBytes = byteLength - HEADER_BYTES;
  if (bodyBytes % bytesPerRow !== 0) {
    throw new Error(
      `Weather file has ${bodyBytes % bytesPerRow} bytes left over after its ${header.rowCount} rows`,
    );
  }
  const expected = header.daysPerYear * header.hoursPerDay * header.yearCount;
  if (header.rowCount !== expected) {
    throw new Error(
      `Weather file holds ${header.rowCount} rows, and its header describes ${expected}`,
    );
  }
  return header;
}

/**
 * Unpacks a downloaded weather file into the rows the game reads.
 *
 * The year and month each row belongs to are its position rather than anything stored: rows run
 * oldest first, one day per calendar month, twenty-four rows to the day. Filling them in here
 * keeps every reader of RawWeatherType working the way it did when this was a CSV with YEAR and
 * MONTH columns of its own.
 */
export function decodeWeather(buffer: ArrayBuffer): RawWeatherType[] {
  const view = new DataView(buffer);
  const header = readHeader(view, buffer.byteLength);
  const tempScale = view.getUint8(12);
  const windScale = view.getUint8(13);
  const precipScale = view.getUint8(14);
  if (tempScale < 1 || windScale < 1 || precipScale < 1) {
    throw new Error("Weather file header has a zero scale factor");
  }

  const rowsPerYear = header.daysPerYear * header.hoursPerDay;
  const bytesPerRow = header.offshore
    ? OFFSHORE_BYTES_PER_ROW
    : BASE_BYTES_PER_ROW;
  const rows: RawWeatherType[] = new Array(header.rowCount);
  for (let row = 0; row < header.rowCount; row++) {
    const at = HEADER_BYTES + row * bytesPerRow;
    const decoded: RawWeatherType = {
      YEAR: header.startingYear + Math.floor(row / rowsPerYear),
      MONTH: Math.floor((row % rowsPerYear) / header.hoursPerDay) + 1,
      TEMP_C: view.getInt16(at, true) / tempScale,
      CLOUD_PCT: view.getUint8(at + 2),
      WIND_KPH: view.getUint8(at + 3) / windScale,
      PRECIP_MM: view.getUint8(at + 4) / precipScale,
    };
    if (header.offshore) {
      decoded.WIND_OFFSHORE_KPH = view.getUint8(at + 5) / windScale;
    }
    rows[row] = decoded;
  }
  return rows;
}

/**
 * The header alone, for callers that want to know what a file covers without unpacking it.
 */
export function readWeatherHeader(buffer: ArrayBuffer): WeatherFileHeaderType {
  return readHeader(new DataView(buffer), buffer.byteLength);
}
