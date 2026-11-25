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

  it("is what every home-screen button reads, with no quieter or deeper blue", () => {
    const styles = withoutComments(read("src/app.scss"));
    // --home-link is the legible blue for the small explore-link row only. Every button
    // group (CTAs, Settings/Quit/Mods, Turn on sound, the couch prompt) must opt back out
    // of it, in both palettes.
    expect(styles).toMatch(
      /#menuCard :is\(\.mainActions, \.resourceActions, \.discoveryActions\),\s*\.couchSettingsPromptActions\s*\{\s*--home-link:\s*var\(--interactive-blue\);\s*\}/,
    );
    expect(styles).toMatch(
      /html\[data-theme="dark"\]\s*#menuCard\s*:is\(\.mainActions, \.resourceActions, \.discoveryActions\),\s*html\[data-theme="dark"\] \.couchSettingsPromptActions\s*\{\s*--home-link:\s*var\(--interactive-blue\);\s*\}/,
    );
    expect(styles).toMatch(
      /#menuCard \.MuiButton-text\.MuiButton-colorPrimary:not\(\.Mui-disabled\),[^{]*\{\s*color:\s*var\(--home-link\);/,
    );
  });
});
