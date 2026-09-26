import { readFileSync, readdirSync } from "fs";
import { relative, resolve, sep } from "path";

const root = process.cwd();
const publicDir = resolve(root, "public");

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name);
    return entry.isDirectory() ? filesUnder(absolute) : [absolute];
  });
}

// The service worker downloads the listed icons in the background, so a stale or incomplete
// manifest means broken artwork offline. This pins the contract that public/icons.json (built
// by `npm run icons:generate` before every test run) lists exactly the images on disk.
describe("public/icons.json", () => {
  it("lists every image under public/images exactly once, in a stable order", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(publicDir, "icons.json"), "utf8"),
    ) as string[];
    const expected = filesUnder(resolve(publicDir, "images"))
      .map((file) => `/${relative(publicDir, file).split(sep).join("/")}`)
      .sort();

    expect(manifest).toEqual(expected);
  });
});
