import { createHash } from "crypto";
import * as libm from "./Libm";
import { pow } from "./Pow";

const view = new DataView(new ArrayBuffer(8));
function bits(x: number): string {
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, "0");
}

type Unary = (x: number) => number;
const UNARY = [
  "exp",
  "log",
  "log1p",
  "log10",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
] as const;
const FUNCTIONS: Record<string, Unary> = {
  ...Object.fromEntries(UNARY.map((name) => [name, libm[name]])),
  atan2: (x: number) => libm.atan2(x, 1 - x),
};
const NATIVE: Record<string, Unary> = {
  ...Object.fromEntries(UNARY.map((name) => [name, Math[name]])),
  atan2: (x: number) => Math.atan2(x, 1 - x),
};

/** 20000 inputs spread over twelve decades either side of zero, the same on every machine. */
function sweepInputs(): number[] {
  let seed = 1;
  const next = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 4294967296;
  };
  return Array.from(
    { length: 20000 },
    () => (next() - 0.5) * 2 * pow(10, next() * 12 - 6),
  );
}

function digest(fn: Unary): string {
  const hash = createHash("sha256");
  for (const x of sweepInputs()) {
    const y = fn(x);
    // NaN payloads differ between V8's C++ and JavaScript and never reach a game
    hash.update(bits(Number.isNaN(y) ? NaN : y));
  }
  return hash.digest("hex");
}

describe("Libm", () => {
  // x86-64 Math's results. An Apple silicon Mac's Math rounds each of these the other way.
  it.each([
    ["exp", -0.18064492740147037, "3feab61f3f23dd5d"],
    ["log", 0.9135428846348077, "bfb726171103f9d2"],
    ["log1p", 5.364309120923281, "3ffd9c7d8fd91ae7"],
    ["log10", 1.5084679191932082, "3fc6da452cf40e8b"],
    ["sin", 6.703506303019822, "3fda1d8c8d602afc"],
    ["sin", 1e22, "bfeb453ab76bf397"],
    ["cos", 1.9081902849732366, "bfd52f94b25c7cd2"],
    ["tan", 3.6336112627759576, "3fe126c79cb3e0c8"],
    ["asin", -0.5996900936588645, "bfe494635ab95cb9"],
    ["acos", -0.5557300709187984, "400147c194fd7570"],
    ["atan", -0.18615647684782743, "bfc78ef120a59e48"],
  ] as const)("rounds %s(%p) as x86-64 does", (name, x, expected) => {
    expect(bits(libm[name](x))).toBe(expected);
  });

  it("rounds atan2 as x86-64 does", () => {
    expect(bits(libm.atan2(0.975, 3.141592653589793))).toBe("3fd34262ea36871c");
  });

  // Pinned on x86-64, where each equals Math's own digest (checked below on that architecture)
  it.each([
    ["exp", "7e51c8ac58f1c8d3c3f48821320b5de63413547fdfc3a24000f51696b5e2ce1c"],
    ["log", "b171a8c99fc9d5f2387d9623b59bf3080041e5fc08a54a31bc9c50ce1b74fe97"],
    [
      "log1p",
      "68ad7e1d56f8469012d3285da60dd25b05b1bb6f77f7e3a1fc3f987b85cac4e5",
    ],
    [
      "log10",
      "7b623475dfaf50ecf8b019b400b24c7e6f9e0c50689bbd4474eb9782b8fd9ae3",
    ],
    ["sin", "dee00b87ecaaa32326f5834d2c69720d1243c1b1a0d8156f0b3447f2808a7f61"],
    ["cos", "8898ce2c3b860049c643dcef03bc4b6aeaccad24768a0a43319bd195c3c411ce"],
    ["tan", "5e90a981afeee1c7a40ebab4cd26ff9217805e5bdf24f82de9951225571034af"],
    [
      "asin",
      "f4b49e33c5182399011c7af43a4b8288e9d454fa265f1928c238e03b7518915d",
    ],
    [
      "acos",
      "a6a2bc2da3de055a02e0475fddabb95813dd0324795b64579e2a3733395d6f96",
    ],
    [
      "atan",
      "fa30ba929f666dbc566d991a42a1e6ae2d4179cf3fb0d8fd43c928937bd698b3",
    ],
    [
      "atan2",
      "a9000edc8b5642241fbc9b8d816039622be4ef0aa522b777f1d8cbcb8375c094",
    ],
  ])("returns the same %s on every machine", (name, expected) => {
    expect(digest(FUNCTIONS[name])).toBe(expected);
  });

  (process.arch === "x64" ? it.each : it.skip.each)(Object.keys(FUNCTIONS))(
    "matches x86-64 Math.%s bit for bit",
    (name) => {
      expect(digest(FUNCTIONS[name])).toBe(digest(NATIVE[name]));
    },
  );

  it("matches Math's special cases exactly", () => {
    const special = [0, -0, 1, -1, Infinity, -Infinity, NaN, 2 ** 1023];
    for (const name of UNARY)
      for (const x of special)
        expect([name, x, libm[name](x)]).toEqual([name, x, Math[name](x)]);
    for (const y of special)
      for (const x of special)
        expect([y, x, libm.atan2(y, x)]).toEqual([y, x, Math.atan2(y, x)]);
  });
});
