import { existsSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { LOCATIONS } from "./Constants";
import { GENERATORS, STORAGE } from "./data/Facilities";
import { SCENARIOS } from "./data/Scenarios";
import { getDateFromMinute } from "./helpers/DateTime";
import { GameType, LocationType } from "./Types";

const {
  EXCLUDED,
  iconUrls,
  output,
}: {
  EXCLUDED: Set<string>;
  iconUrls: () => string[];
  output: string;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
} = require("../scripts/generate-icon-manifest");

const publicDir = resolve(process.cwd(), "public");
const srcDir = resolve(process.cwd(), "src");

/** The cache key the browser uses for an `<img src>`, e.g. spaces become `%20`. */
function requestPath(src: string) {
  return new URL(src, "https://electrify.test").pathname;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(tsx?|scss)$/.test(entry.name) &&
      !/\.(test|spec)\./.test(entry.name)
      ? [path]
      : [];
  });
}

// The service worker downloads the listed icons in the background, so a stale or incomplete
// manifest means broken artwork offline.
describe("public/icons.json", () => {
  const manifest = JSON.parse(readFileSync(output, "utf8")) as string[];

  it("is current with public/images (rebuilt by `npm run icons:generate`)", () => {
    expect(manifest).toEqual(iconUrls());
    expect(new Set(manifest).size).toBe(manifest.length);
  });

  it("lists URLs that resolve to image files on disk", () => {
    for (const url of manifest) {
      expect(url).toMatch(/^\/images\/[^#?\s]+$/);
      expect(
        existsSync(resolve(publicDir, `.${decodeURIComponent(url)}`)),
      ).toBe(true);
    }
  });

  it("leaves out images the app never displays, and every exclusion still names a file", () => {
    for (const url of EXCLUDED) {
      expect(manifest).not.toContain(requestPath(url));
      expect(existsSync(resolve(publicDir, `.${url}`))).toBe(true);
    }
    expect(manifest).not.toContain("/images/icon/1024x1024.png");
  });

  it("lists every image path written literally in the app's source", () => {
    const literal = /\/images\/[^"'`${}()\s]+\.(?:svg|png|jpe?g|gif|webp)/g;
    const referenced = [
      ...new Set(
        sourceFiles(srcDir).flatMap(
          (file) => readFileSync(file, "utf8").match(literal) ?? [],
        ),
      ),
    ].sort();

    // Guard against the scan silently matching nothing.
    expect(referenced).toEqual(
      expect.arrayContaining([
        "/images/logo.svg",
        "/images/transmission.svg",
        "/images/manual-demand.webp",
      ]),
    );
    expect(manifest).toEqual(
      expect.arrayContaining(referenced.map(requestPath)),
    );
  });

  it("covers the icon of every scenario and the intertie", () => {
    const requested = [
      ...SCENARIOS.map(
        (scenario) => `/images/${scenario.icon.toLowerCase()}.svg`,
      ),
      "/images/transmission.svg",
    ].map(requestPath);

    expect(manifest).toEqual(expect.arrayContaining(requested));
  });

  it("covers the icon of every facility the player can build", () => {
    const names = new Set<string>();
    for (const location of Object.values(LOCATIONS) as LocationType[]) {
      for (const year of [1990, 2025, 2050]) {
        const state = {
          date: getDateFromMinute(0, year),
          startingYear: year,
          difficulty: "CEO",
          feePerKgCO2e: 0,
          seed: 1,
          facilities: [],
          location,
        } as unknown as GameType;
        for (const facility of [
          ...GENERATORS(state, 1e9, [], []),
          ...STORAGE(state, 1e9),
        ]) {
          names.add(facility.name.toLowerCase());
        }
      }
    }

    // Mirrors the build and facility lists: `/images/${facility.name.toLowerCase()}.svg`.
    expect(names.size).toBeGreaterThan(5);
    expect(manifest).toEqual(
      expect.arrayContaining(
        [...names].map((name) => requestPath(`/images/${name}.svg`)),
      ),
    );
  });
});
