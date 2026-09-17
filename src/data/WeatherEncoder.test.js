const fs = require("fs");
const path = require("path");
const {
  encodeWeather,
  extendPackedWeather,
} = require("../../scripts/fetch-weather");
const { cities } = require("../../scripts/cities.json");

const onshore = { id: "Onshore" };
const offshore = { id: "Offshore", offshore: { lat: 1, long: 2 } };
const row = {
  tempC: -12.3,
  windKph: 20.5,
  cloudPct: 75,
  precipMm: 1.2,
  windOffshoreKph: 35.5,
};

test("catalogue excludes even complete or partial offshore readings from onshore files", () => {
  const base = { ...row, windOffshoreKph: undefined };
  const expected = encodeWeather(onshore, [base, base]);
  for (const rows of [
    [row, row],
    [row, base],
  ]) {
    const file = encodeWeather(onshore, rows);
    expect(file).toEqual(expected);
    expect(file[7]).toBe(5);
    expect(file[15]).toBe(0);
    expect(file.length).toBe(26);
  }
});

test("catalogue offshore points require a complete finite series", () => {
  const file = encodeWeather(offshore, [row]);
  expect(file[7]).toBe(6);
  expect(file[15]).toBe(1);
  expect(file[21]).toBe(71);
  for (const windOffshoreKph of [undefined, NaN, Infinity]) {
    expect(() =>
      encodeWeather(offshore, [row, { ...row, windOffshoreKph }]),
    ).toThrow("offshore wind is missing or invalid");
  }
});

test.each([onshore, offshore])(
  "updates retain the catalogue layout for $id",
  (city) => {
    const original = encodeWeather(city, [row], 1980);
    const extended = extendPackedWeather(
      { city, file: original, bytesPerRow: original[7] },
      [row],
      1981,
    );
    expect(extended[7]).toBe(original[7]);
    expect(extended[15]).toBe(original[15]);
    expect(extended.readUInt16LE(10)).toBe(2);
    expect(extended.subarray(16)).toEqual(
      Buffer.concat([original.subarray(16), original.subarray(16)]),
    );
  },
);

test.each(["Baltimore", "Paris", "SF"])(
  "%s shipped weather agrees with its catalogue offshore point",
  (id) => {
    const city = cities.find((city) => city.id === id);
    const file = fs.readFileSync(
      path.resolve(__dirname, "../../public/data/weather", `${id}.bin`),
    );
    const hasOffshore = Boolean(city.offshore);
    expect(Boolean(file[15] & 1)).toBe(hasOffshore);
    expect(file[7]).toBe(hasOffshore ? 6 : 5);
    expect(file.length).toBe(16 + file.readUInt16LE(10) * 12 * 24 * file[7]);
  },
);
