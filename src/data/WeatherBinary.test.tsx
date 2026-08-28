import * as fs from "fs";
import * as path from "path";
import { decodeWeather, readWeatherHeader } from "./WeatherBinary";
import { RawWeatherType } from "../Types";
import { getOffshoreWindCapacityFactor } from "../helpers/Energy";

const DATA_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "public",
  "data",
  "weather",
);
const HEADER_BYTES = 16;
const BASE_BYTES_PER_ROW = 5;
const OFFSHORE_BYTES_PER_ROW = 6;

function readShipped(id: string, offshore = false): ArrayBuffer {
  const bytes = fs.readFileSync(
    path.join(DATA_DIR, `${id}${offshore ? ".v2" : ""}.bin`),
  );
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

// A file built here rather than fetched, for the cases a real one can't cover: a header that
// says something this build doesn't read, and quantised values whose exact answer is known
function buildFile(
  overrides: {
    magic?: string;
    version?: number;
    daysPerYear?: number;
    hoursPerDay?: number;
    bytesPerRow?: number;
    yearCount?: number;
    tempScale?: number;
    flags?: number;
  } = {},
  rows: {
    temp: number;
    cloud: number;
    wind: number;
    precip: number;
    offshoreWind?: number;
  }[] = [],
): ArrayBuffer {
  const rowBytes =
    overrides.bytesPerRow ??
    (rows.some((row) => row.offshoreWind !== undefined)
      ? OFFSHORE_BYTES_PER_ROW
      : BASE_BYTES_PER_ROW);
  const buffer = new ArrayBuffer(HEADER_BYTES + rows.length * rowBytes);
  const view = new DataView(buffer);
  const magic = overrides.magic ?? "EWX1";
  for (let i = 0; i < 4; i++) {
    view.setUint8(i, magic.charCodeAt(i));
  }
  view.setUint8(
    4,
    overrides.version ?? (rowBytes === OFFSHORE_BYTES_PER_ROW ? 2 : 1),
  );
  view.setUint8(5, overrides.daysPerYear ?? 1);
  view.setUint8(6, overrides.hoursPerDay ?? rows.length);
  view.setUint8(7, rowBytes);
  view.setUint16(8, 1980, true);
  view.setUint16(10, overrides.yearCount ?? 1, true);
  view.setUint8(12, overrides.tempScale ?? 10);
  view.setUint8(13, 2);
  view.setUint8(14, 5);
  view.setUint8(
    15,
    overrides.flags ?? (rowBytes === OFFSHORE_BYTES_PER_ROW ? 1 : 0),
  );
  rows.forEach((row, index) => {
    const at = HEADER_BYTES + index * rowBytes;
    view.setInt16(at, row.temp, true);
    view.setUint8(at + 2, row.cloud);
    view.setUint8(at + 3, row.wind);
    view.setUint8(at + 4, row.precip);
    if (row.offshoreWind !== undefined && rowBytes > BASE_BYTES_PER_ROW) {
      view.setUint8(at + 5, row.offshoreWind);
    }
  });
  return buffer;
}

describe("decodeWeather", () => {
  it("applies the scales the header declares", () => {
    const rows = decodeWeather(
      buildFile({ hoursPerDay: 2 }, [
        { temp: -125, cloud: 66, wind: 9, precip: 3 },
        { temp: 2048, cloud: 0, wind: 255, precip: 0 },
      ]),
    );
    expect(rows[0]).toEqual({
      YEAR: 1980,
      MONTH: 1,
      TEMP_C: -12.5,
      CLOUD_PCT: 66,
      WIND_KPH: 4.5,
      PRECIP_MM: 0.6,
    });
    // The top of each field's range, which is what a heatwave or a gale packs down to
    expect(rows[1].TEMP_C).toEqual(204.8);
    expect(rows[1].WIND_KPH).toEqual(127.5);
  });

  it("numbers rows by position rather than storing their date", () => {
    const rows = decodeWeather(
      buildFile({ daysPerYear: 2, hoursPerDay: 2, yearCount: 2 }, [
        { temp: 0, cloud: 0, wind: 0, precip: 0 },
        { temp: 0, cloud: 0, wind: 0, precip: 0 },
        { temp: 0, cloud: 0, wind: 0, precip: 0 },
        { temp: 0, cloud: 0, wind: 0, precip: 0 },
        { temp: 0, cloud: 0, wind: 0, precip: 0 },
        { temp: 0, cloud: 0, wind: 0, precip: 0 },
        { temp: 0, cloud: 0, wind: 0, precip: 0 },
        { temp: 0, cloud: 0, wind: 0, precip: 0 },
      ]),
    );
    expect(rows.map((r: RawWeatherType) => `${r.YEAR}-${r.MONTH}`)).toEqual([
      "1980-1",
      "1980-1",
      "1980-2",
      "1980-2",
      "1981-1",
      "1981-1",
      "1981-2",
      "1981-2",
    ]);
  });

  it("decodes the optional offshore column in v2 files", () => {
    expect(
      decodeWeather(
        buildFile({}, [
          { temp: 100, cloud: 20, wind: 18, precip: 0, offshoreWind: 55 },
        ]),
      )[0],
    ).toMatchObject({
      WIND_KPH: 9,
      WIND_OFFSHORE_KPH: 27.5,
    });
  });

  it("allows v2 files to keep the compact inland row", () => {
    const buffer = buildFile({ version: 2 }, [
      { temp: 100, cloud: 20, wind: 18, precip: 0 },
    ]);
    expect(readWeatherHeader(buffer)).toMatchObject({
      version: 2,
      offshore: false,
    });
    expect(decodeWeather(buffer)[0].WIND_OFFSHORE_KPH).toBeUndefined();
  });

  // Every one of these would otherwise decode into a plausible looking array of nonsense, and a
  // game played on nonsense weather runs perfectly well and is simply wrong
  it("refuses a file it cannot vouch for", () => {
    expect(() => decodeWeather(buildFile({ magic: "CSV," }))).toThrow(/EWX1/);
    expect(() => decodeWeather(buildFile({ version: 3 }))).toThrow(/version 3/);
    expect(() => decodeWeather(buildFile({ bytesPerRow: 3 }))).toThrow(
      /3 byte rows/,
    );
    expect(() => decodeWeather(new ArrayBuffer(4))).toThrow(/too short/);
    expect(() =>
      decodeWeather(buildFile({ version: 2, bytesPerRow: 6, flags: 0 })),
    ).toThrow(/describes 5/);
    // A truncated download: the header promises a day of readings, the body holds most of one
    expect(() =>
      decodeWeather(
        buildFile({ hoursPerDay: 24 }, [
          { temp: 0, cloud: 0, wind: 0, precip: 0 },
        ]),
      ),
    ).toThrow(/describes 24/);
  });

  // A row's month is worked out from its position -- one recorded day per calendar month -- so a
  // file claiming more days than a year has months would hand every reader of RawWeatherType a
  // MONTH of 13 and up, which is not a month and which nothing downstream would question
  it("refuses more days a year than a year has months", () => {
    expect(() =>
      decodeWeather(
        buildFile({ daysPerYear: 13, hoursPerDay: 1, yearCount: 1 }, [
          { temp: 0, cloud: 0, wind: 0, precip: 0 },
        ]),
      ),
    ).toThrow(/13 days a year/);
    expect(() =>
      decodeWeather(buildFile({ daysPerYear: 0, hoursPerDay: 1 })),
    ).toThrow(/0 days a year/);
  });
});

// Reading what is actually in public/data is the only check that the fetch script and this
// decoder still agree about the format: they are written in different languages against the same
// sixteen byte header, and nothing but a shipped file exercises both halves at once
describe("the shipped weather files", () => {
  const offshoreIds = [
    "SF",
    "LA",
    "HNL",
    "SJU",
    "NewYork",
    "London",
    "Reykjavik",
  ];
  const ids = fs
    .readdirSync(DATA_DIR)
    .filter(
      (file: string) => file.endsWith(".bin") && !file.endsWith(".v2.bin"),
    )
    .map((file: string) => file.replace(".bin", ""));

  it("ships at least the locations the authored scenarios are played in", () => {
    expect(ids).toEqual(expect.arrayContaining(["PIT", "SF", "HNL", "SJU"]));
  });

  it("keeps the catalogue flags in sync with the binary headers", () => {
    const index = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, "index.json"), "utf8"),
    );
    const listed = Object.values(index.cities)
      .filter((city) => (city as { offshore?: boolean }).offshore)
      .map((city) => (city as { id: string }).id)
      .sort();
    expect(listed).toEqual([...offshoreIds].sort());
  });

  it.each(ids)("%s covers forty years of readable weather", (id: string) => {
    const offshore = offshoreIds.includes(id);
    const buffer = readShipped(id, offshore);
    const header = readWeatherHeader(buffer);
    expect(header.version).toBe(offshore ? 2 : 1);
    expect(header).toMatchObject({
      daysPerYear: 12,
      hoursPerDay: 24,
      startingYear: 1980,
      yearCount: 40,
      rowCount: 11520,
      offshore,
    });

    const rows = decodeWeather(buffer);
    expect(rows[0].YEAR).toEqual(1980);
    expect(rows[rows.length - 1].YEAR).toEqual(2019);

    // Reduced to one assertion per field rather than one per row: eleven thousand assertions a
    // city adds up to minutes once the catalogue is full, and a range says the same thing
    const range = (field: keyof RawWeatherType) => {
      const values = rows
        .map((row: RawWeatherType) => row[field])
        .filter((value): value is number => value !== undefined);
      return { min: Math.min(...values), max: Math.max(...values) };
    };
    // Deliberately generous: these are the bounds that catch a byte order or a scale being
    // wrong, not a claim about any particular city's climate
    expect(range("TEMP_C").min).toBeGreaterThan(-80);
    expect(range("TEMP_C").max).toBeLessThan(60);
    expect(range("CLOUD_PCT").min).toBeGreaterThanOrEqual(0);
    expect(range("CLOUD_PCT").max).toBeLessThanOrEqual(100);
    expect(range("WIND_KPH").min).toBeGreaterThanOrEqual(0);
    expect(range("PRECIP_MM").min).toBeGreaterThanOrEqual(0);
  });

  it("puts Pittsburgh's rows in season order", () => {
    const rows = decodeWeather(readShipped("PIT"));
    const monthMean = (month: number) => {
      const of = rows.filter((row: RawWeatherType) => row.MONTH === month);
      return of.reduce((total, row) => total + row.TEMP_C, 0) / of.length;
    };
    // Rows run oldest first, twenty-four to a day and one day to a month. Get that wrong in
    // either direction and January stops being the cold one.
    expect(monthMean(1)).toBeLessThan(0);
    expect(monthMean(7)).toBeGreaterThan(20);
  });

  it.each(offshoreIds)("%s has a usable offshore wind resource", (id) => {
    const speeds = decodeWeather(readShipped(id, true)).map(
      (row) => row.WIND_OFFSHORE_KPH as number,
    );
    const capacityFactor = getOffshoreWindCapacityFactor(speeds);
    expect(capacityFactor).toBeGreaterThan(0.2);
    expect(capacityFactor).toBeLessThan(0.7);
  });

  it.each(offshoreIds)("%s keeps a v1 asset for older clients", (id) => {
    const header = readWeatherHeader(readShipped(id));
    expect(header).toMatchObject({ version: 1, offshore: false });
  });
});
