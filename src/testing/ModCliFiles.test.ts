import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { MAX_MOD_BYTES, parseMod } from "../mods/ModSchema";
import { readModCliJson } from "./ModCliFiles";

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "electrify-cli-input-"));
});

test("the CLI JSON grammar preserves the native parser's rejection of a leading UTF-8 BOM", () => {
  const file = path.join(directory, "scenario.json");
  fs.writeFileSync(
    file,
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{}")]),
  );
  expect(() => parseMod(fs.readFileSync(file, "utf8"))).toThrow(
    /not valid JSON/,
  );
  expect(() => readModCliJson(file)).toThrow();
  fs.writeFileSync(file, "{}");
  expect(readModCliJson(file)).toEqual({});
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

test("author JSON files use strict UTF-8 and reject oversized, truncated and missing inputs", () => {
  const file = path.join(directory, "scenario.json");
  fs.writeFileSync(file, JSON.stringify({ description: "Électricité" }));
  expect(readModCliJson(file)).toEqual({ description: "Électricité" });
  fs.writeFileSync(
    file,
    Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]),
  );
  expect(() => readModCliJson(file)).toThrow(/encoded data|UTF-8/i);
  fs.writeFileSync(file, '{"responses":[');
  expect(() => readModCliJson(file)).toThrow();
  fs.writeFileSync(file, " ".repeat(MAX_MOD_BYTES + 1));
  expect(() => readModCliJson(file)).toThrow(/authoring limit/);
  fs.unlinkSync(file);
  expect(() => readModCliJson(file)).toThrow(/ENOENT/);
});
