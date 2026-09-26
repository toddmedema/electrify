import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { SCENARIOS } from "./data/Scenarios";

const {
  iconUrls,
  output,
}: {
  iconUrls: () => string[];
  output: string;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
} = require("../scripts/generate-icon-manifest");

const publicDir = resolve(process.cwd(), "public");

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

  it("covers the artwork every scenario and the intertie request", () => {
    // Match the browser's encoding of the `src` the views build, which is also the cache key.
    const requested = [
      ...SCENARIOS.map(
        (scenario) => `/images/${scenario.icon.toLowerCase()}.svg`,
      ),
      "/images/transmission.svg",
    ].map((url) => new URL(url, "https://electrify.test").pathname);

    expect(manifest).toEqual(expect.arrayContaining(requested));
  });
});
