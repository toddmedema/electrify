/**
 * The reader for the two hand-maintained data files, public/data/EconomyRaw.csv and
 * public/data/FuelPricesRaw.csv.
 *
 * Deliberately not a CSV library. Those files are numbers written by us: one delimiter, no quoted
 * fields, no commas inside a value, and 540 rows apiece - for which papaparse cost 6.7KB gzipped
 * and a dependency. What this handles instead of a general grammar is the narrow set of ways a
 * hand-edited file actually goes wrong, and it throws on each rather than parsing on into a table
 * of NaN, because rates that silently read as zero are a game that runs and is simply wrong.
 *
 * Fields come back as the strings they were written as. Both callers coerce with unary + on the
 * way into their tables, so converting here would only mean guessing which columns are numbers.
 */

// Written by a spreadsheet's "CSV UTF-8" export. Left in place it becomes part of the first
// column's name, so `month` is spelt "\uFEFFmonth", every lookup of it is undefined, and every
// row of the file lands under year NaN.
const BOM = "\uFEFF";

export type CsvRowType = Record<string, string>;

export function parseCsv<T extends CsvRowType = CsvRowType>(csv: string): T[] {
  const text = csv.startsWith(BOM) ? csv.slice(BOM.length) : csv;
  if (text.includes('"')) {
    throw new Error(
      "CSV has a quote character in it, and this reader does not handle quoted fields. Either a " +
        "column now holds something that needs them, in which case this has to grow into a real " +
        "parser, or the file was written by something that quotes everything.",
    );
  }
  const lines = text.split("\n");
  const rows: T[] = [];
  let headers: string[] | undefined;
  for (let i = 0; i < lines.length; i++) {
    // Trimming the line is also what absorbs the \r of a CRLF file. .gitattributes normalises
    // these two to LF on checkout, but nothing stops an editor from writing CRLF in between.
    const line = lines[i].trim();
    if (line === "") {
      continue; // Blank lines, including the one a file ending in a newline leaves behind
    }
    const cells = line.split(",");
    if (!headers) {
      headers = cells;
      continue;
    }
    const columns = headers;
    if (cells.length !== columns.length) {
      throw new Error(
        `CSV line ${i + 1} has ${cells.length} fields, and its header has ${columns.length}`,
      );
    }
    // Null prototype: the keys are whatever the header row happens to say, and a column called
    // __proto__ should be a column rather than a write to Object.prototype
    const row = Object.create(null) as CsvRowType;
    columns.forEach((header: string, column: number) => {
      row[header] = cells[column];
    });
    rows.push(row as T);
  }
  return rows;
}

/** Downloads and parses one of the files, for the browser. */
export function fetchCsv<T extends CsvRowType = CsvRowType>(
  url: string,
): Promise<T[]> {
  return fetch(url)
    .then((response: Response) => {
      if (!response.ok) {
        throw new Error(`${response.status} fetching ${url}`);
      }
      return response.text();
    })
    .then((text: string) => parseCsv<T>(text));
}
