import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/*
 * ############################################################################
 * #                                                                          #
 * #   DANGER   DANGER   DANGER   DANGER   DANGER   DANGER   DANGER           #
 * #                                                                          #
 * #   CHANGING THE CTA COLOR IS NOT ALLOWED.                                 #
 * #                                                                          #
 * #   The call-to-action blue, the logo blue and the blue of the smoke on    #
 * #   the home-screen logo are ONE color. The owner has had to say STOP      #
 * #   more than once. If this test fails, you changed it. Put it back.       #
 * #                                                                          #
 * #   Do NOT edit CTA_BLUE below to make the test pass. Do NOT delete or     #
 * #   loosen an assertion. Do NOT re-declare --interactive-blue anywhere     #
 * #   (not for one screen, not for dark mode, not for an accessibility or    #
 * #   contrast score). If a label is hard to read on the blue, change the   #
 * #   label. A different CTA color needs the owner's explicit, written       #
 * #   say-so in the task itself - an audit finding does not count.           #
 * #                                                                          #
 * ############################################################################
 */
const CTA_BLUE = { light: "#0084f8", dark: "#629be1" } as const;

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function stylesheets(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return stylesheets(path);
      return /\.(s?css)$/.test(entry.name) ? [path] : [];
    },
  );
}

function logoFills(path: string): string[] {
  return Array.from(
    new Set(
      Array.from(read(path).matchAll(/fill="(#[0-9a-f]{6})"/gi), (match) =>
        match[1].toLowerCase(),
      ),
    ),
  );
}

describe("the CTA blue is the logo blue", () => {
  it("is exactly the color painted in the logo", () => {
    expect(logoFills("public/images/logo-home.svg")).toEqual([CTA_BLUE.light]);
    expect(logoFills("public/images/logo-home-dark.svg")).toEqual([
      CTA_BLUE.dark,
    ]);
  });

  it("is declared once per palette, and never re-declared by any other rule", () => {
    const declarations = stylesheets("src").flatMap((path) =>
      Array.from(
        withoutComments(read(path)).matchAll(
          /--interactive-blue\s*:\s*([^;}]+)[;}]/g,
        ),
        (match) => `${path}: ${match[1].trim().toLowerCase()}`,
      ),
    );
    expect(declarations).toEqual([
      `src/app.scss: ${CTA_BLUE.light}`,
      `src/app.scss: ${CTA_BLUE.dark}`,
    ]);
  });

  it("is the interactive color the chart theme reads", () => {
    const theme = read("src/Theme.tsx");
    const logoBlue = theme.match(
      /const LOGO_BLUE[^=]*=\s*\{\s*light:\s*"(#[0-9a-f]{6})",\s*dark:\s*"(#[0-9a-f]{6})"/i,
    );
    expect(logoBlue?.slice(1, 3).map((color) => color.toLowerCase())).toEqual([
      CTA_BLUE.light,
      CTA_BLUE.dark,
    ]);
  });

  it("paints the home-screen logo smoke", () => {
    const styles = withoutComments(read("src/app.scss"));
    expect(styles).toMatch(
      /\.homeSmokePuff\s*\{\s*fill:\s*var\(--interactive-blue\);/,
    );
  });

  it("is what every home-screen button and link reads, with no quieter or deeper blue", () => {
    const styles = withoutComments(read("src/app.scss"));
    expect(styles).toMatch(
      /\.homeExplore a\s*\{[^}]*text-decoration-color:\s*var\(--interactive-blue\);/,
    );
    expect(styles).toMatch(
      /#menuCard\s+\.homeExplore\s+a:focus\s*\{[^}]*outline:\s*2px solid var\(--interactive-blue\);/,
    );
  });

  it("is the link and button blue on the static site pages, in both palettes", () => {
    const styles = withoutComments(read("public/legal.css"));
    expect(
      Array.from(styles.matchAll(/--brand:\s*(#[0-9a-f]{6})/gi), (match) =>
        match[1].toLowerCase(),
      ),
    ).toEqual([CTA_BLUE.light, CTA_BLUE.dark]);
    expect(styles).toMatch(/(^|\n)a\s*\{\s*color:\s*var\(--brand\);/);
    expect(styles).toMatch(
      /\.button--primary\s*\{\s*border-color:\s*var\(--brand\);\s*background:\s*var\(--brand\);/,
    );
    const shell = read("public/index.html");
    expect(shell).toMatch(
      /\.app-loading a\s*\{[^}]*text-decoration-color:\s*#0084f8;/,
    );
    expect(shell).toMatch(
      /@media \(prefers-color-scheme: dark\)[^@]*\.app-loading a\s*\{[^}]*text-decoration-color:\s*#629be1;/,
    );
  });

  it("has no second blue for buttons or links anywhere: the old shades and tokens stay gone", () => {
    // Each of these was once a "more legible" CTA or link blue. Chart series colors in
    // Theme.tsx are data colors, not interface blues, and are not scanned.
    const forbidden = [
      "#0868be",
      "#8bc8f8",
      "#0066cc",
      "#8db6ee",
      "#006bc7",
      "#64b5f6",
      "--home-link",
      "--interactive-strong",
      "--brand-strong",
      "--brand-deep",
    ];
    const publicStyles = readdirSync(join(root, "public")).filter((name) =>
      name.endsWith(".css"),
    );
    const files = [
      ...stylesheets("src"),
      ...publicStyles.map((name) => `public/${name}`),
      "public/index.html",
    ];
    const found = files.flatMap((path) => {
      const source = withoutComments(read(path)).toLowerCase();
      return forbidden
        .filter((blue) => source.includes(blue))
        .map((blue) => `${path}: ${blue}`);
    });
    expect(found).toEqual([]);
  });
});
