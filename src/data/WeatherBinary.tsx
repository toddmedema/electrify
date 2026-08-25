import { RawWeatherType } from "../Types";

/**
 * Reader for the packed weather files in public/data/weather, written by scripts/fetch-weather.js.
 *
 * A location's whole record is twelve days a year for forty years - 11,520 hourly readings - and
 * as CSV that was 265KB of text to download and parse before the first frame of a game. Packed it
 * is 57KB and a single pass over a DataView, which is what makes shipping hundreds of cities
 * affordable rather than a megabyte apiece.
 *
 * The layout is deliberately self-describing: the header carries the scale each field was
 * quantised with, so this file and the fetch script cannot quietly disagree about whether wind is
 * in whole kph or half kph. Anything that doesn't parse throws rather than returning a plausible
 * looking array of zeroes, because forty years of 0C is a game that runs and is simply wrong.
 */

const MAGIC = "EWX1";
const SUPPORTED_VERSION = 1;
const HEADER_BYTES = 16;
const BYTES_PER_ROW = 5;

export interface WeatherFileHeaderType {
  version: number;
  daysPerYear: number;
  hoursPerDay: number;
  startingYear: number;
  yearCount: number;
  rowCount: number;
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
  if (version !== SUPPORTED_VERSION) {
    throw new Error(
      `Weather file is version ${version}, and this build reads version ${SUPPORTED_VERSION}`,
    );
  }
  const bytesPerRow = view.getUint8(7);
  if (bytesPerRow !== BYTES_PER_ROW) {
    throw new Error(
      `Weather file has ${bytesPerRow} byte rows, and this build reads ${BYTES_PER_ROW}`,
    );
  }
  const header = {
    version,
    daysPerYear: view.getUint8(5),
    hoursPerDay: view.getUint8(6),
    startingYear: view.getUint16(8, true),
    yearCount: view.getUint16(10, true),
    rowCount: Math.floor((byteLength - HEADER_BYTES) / BYTES_PER_ROW),
  };
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
  const rows: RawWeatherType[] = new Array(header.rowCount);
  for (let row = 0; row < header.rowCount; row++) {
    const at = HEADER_BYTES + row * BYTES_PER_ROW;
    rows[row] = {
      YEAR: header.startingYear + Math.floor(row / rowsPerYear),
      MONTH: Math.floor((row % rowsPerYear) / header.hoursPerDay) + 1,
      TEMP_C: view.getInt16(at, true) / tempScale,
      CLOUD_PCT: view.getUint8(at + 2),
      WIND_KPH: view.getUint8(at + 3) / windScale,
      PRECIP_MM: view.getUint8(at + 4) / precipScale,
    };
  }
  return rows;
}

/**
 * The header alone, for callers that want to know what a file covers without unpacking it.
 */
export function readWeatherHeader(buffer: ArrayBuffer): WeatherFileHeaderType {
  return readHeader(new DataView(buffer), buffer.byteLength);
}
