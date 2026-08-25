import { parseCsv } from "./Csv";

const HEADER = "month,year,prime,inflation";

describe("parseCsv", () => {
  it("keys each row by the column names in the header", () => {
    expect(parseCsv(`${HEADER}\n12,2019,4.75,0.0180`)).toEqual([
      { month: "12", year: "2019", prime: "4.75", inflation: "0.0180" },
    ]);
  });

  // FuelPricesRaw.csv and the fixture FuelPrices.test.tsx builds list their columns in different
  // orders, so reading by position rather than by name would silently swap coal and gas
  it("reads by column name rather than by position", () => {
    const [row] = parseCsv("year,month,coal,oil\n2019,12,2.9,9.76");
    const [swapped] = parseCsv("month,year,oil,coal\n12,2019,9.76,2.9");
    expect(row).toEqual(swapped);
  });

  it("gives back no rows for a header on its own", () => {
    expect(parseCsv(HEADER)).toEqual([]);
  });

  it("gives back no rows for an empty file", () => {
    expect(parseCsv("")).toEqual([]);
  });

  // The blank row a file ending in a newline leaves behind. EconomyRaw.csv ends in one and
  // FuelPricesRaw.csv does not, and neither should be able to tell the difference here
  it("skips the blank line left by a file ending in a newline", () => {
    expect(parseCsv(`${HEADER}\n12,2019,4.75,0.0180\n`)).toHaveLength(1);
  });

  it("skips blank lines in the middle of a file", () => {
    expect(
      parseCsv(`${HEADER}\n12,2019,4.75,0.0180\n\n11,2019,4.75,0.0180`),
    ).toHaveLength(2);
  });

  // What a spreadsheet's "CSV UTF-8" export writes. Left in place it renames the first column,
  // so every lookup of `month` is undefined and every row lands under year NaN
  it("strips a byte order mark rather than reading it as part of the first column name", () => {
    const [row] = parseCsv(`\uFEFF${HEADER}\n12,2019,4.75,0.0180`);
    expect(row.month).toEqual("12");
  });

  // .gitattributes normalises these files to LF on checkout, but nothing stops an editor from
  // writing CRLF in between, and a stray \r turns the last column of every row into NaN
  it("reads a file written with CRLF line endings", () => {
    const [row] = parseCsv(`${HEADER}\r\n12,2019,4.75,0.0180\r\n`);
    expect(row.inflation).toEqual("0.0180");
  });

  it("throws on a quoted field rather than splitting through the quotes", () => {
    expect(() => parseCsv(`${HEADER}\n12,2019,"4,75",0.0180`)).toThrow(/quote/);
  });

  it("throws on a row whose field count has drifted from the header's", () => {
    expect(() => parseCsv(`${HEADER}\n12,2019,4.75`)).toThrow(/line 2/);
  });

  it("names the line a short row is actually on, counting blank lines", () => {
    expect(() => parseCsv(`${HEADER}\n\n12,2019,4.75`)).toThrow(/line 3/);
  });

  // The header row is data from a file, so a column called __proto__ has to stay a column
  it("does not let a __proto__ column reach Object.prototype", () => {
    const [row] = parseCsv("__proto__,year\npolluted,2019");
    expect(row.__proto__).toEqual("polluted");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
});
