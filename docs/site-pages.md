# Public pages

Electrify's public pages are static HTML. A reader or crawler can follow links,
read each scenario, and find its play link without loading the game or running
JavaScript.

## Edit a scenario page

1. Edit its record in `site/scenarios.json`. Keep the existing `scenarioId` and
   `slug`: the ID opens the game, and the slug is the public URL.
2. Run `npm run site:generate`.
3. Review the authored changes and generated HTML together. Run
   `npm run site:check` and `node --test scripts/ci/site-pages.test.js`.

Records hold plain text, not HTML. The shared templates in
`site/templates/pages.js` escape content and generate each page's title,
description, canonical URL, social preview metadata, and structured data.
`public/scenarios.css` adds the scenario layouts to the shared `legal.css` theme.

Generated files are checked in so the normal CRA development server and web
build serve the same pages. Do not edit `public/scenarios.html`,
`public/scenarios/*.html`, `public/sitemap.xml`, or `public/llms.txt` directly.
`site:check`, the CI tooling suite, and web build/start reject stale outputs
without rewriting them.

## Add a scenario

Add the game scenario first, then a content record with its official name,
location, opening year, duration, and SVG icon. Write the opening situation,
the decisions a player will make, and a short invitation to try it. Give it a
unique readable slug and related scenario IDs. Keep the copy useful to a person
choosing what to play; metadata comes from the same content.

Every non-tutorial official scenario and Legacy campaign generation must have a
page. The catalogue parity test reads the game's real scenario definitions to
catch missing pages and stale facts. Campaign records use `kind: "campaign"`;
their play links open campaign setup so a later generation cannot bypass the
company's history.

The generator validates IDs, slugs, required copy, local SVG assets, and related
links before writing. It generates the directory, all scenario pages, the
sitemap, and a short `/llms.txt` directory. It removes retired generated scenario
files and refuses to remove hand-authored files from that directory. A removed
or renamed public URL may still need a hosting redirect; the generator does not
configure hosting.

## Discovery and other public pages

The game HTML and About page link to `/scenarios.html`. The directory links to
every scenario with ordinary anchors; each scenario links back to the directory
and to related challenges. All public URLs also appear in `/sitemap.xml`, which
is advertised by `/robots.txt`. `/llms.txt` gives text-based agents another
entry point; it supplements those standard links.

Existing guides remain hand-authored. Register new public pages in
`scripts/site/registry.js` so the generated sitemap includes them, then add a
useful visible link from an appropriate page. Use stable `.html` URLs, matching
the site's existing hosting. Regenerate after changing the registry, content,
or templates. No runtime routing layer or CMS is required.

The Node tooling tests check escaping, metadata, the link graph, sitemap entries,
determinism, stale outputs, and retired-page cleanup. Browser checks cover
navigation without JavaScript and layout at desktop and phone widths in both
themes.
