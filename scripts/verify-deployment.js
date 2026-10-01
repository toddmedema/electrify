#!/usr/bin/env node
// Check ordinary public URLs so cache-busting cannot hide a stale CDN response.
const { readdir, readFile } = require("node:fs/promises");
const path = require("node:path");

async function verifyDeployment(
  buildDir = "build",
  baseUrl = "https://electrifygame.com",
) {
  const entries = await readdir(buildDir, {
    recursive: true,
    withFileTypes: true,
  });
  const pages = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".html"),
  );
  if (!pages.length) throw new Error("Build contains no HTML pages");
  for (const entry of pages) {
    const file = path.join(entry.parentPath, entry.name);
    const relative = path.relative(buildDir, file).split(path.sep).join("/");
    const routes =
      relative === "index.html" ? ["/", "/index.html"] : [`/${relative}`];
    const expected = await readFile(file);
    for (const route of routes) {
      const url = new URL(route, baseUrl);
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      });
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      if (!response.headers.get("content-type")?.startsWith("text/html"))
        throw new Error(`${url}: expected text/html`);
      const cacheControl = response.headers.get("cache-control") || "";
      if (
        !/(?:^|,)\s*max-age=0(?:\s*,|$)/i.test(cacheControl) ||
        !/(?:^|,)\s*must-revalidate(?:\s*,|$)/i.test(cacheControl)
      )
        throw new Error(
          `${url}: HTML must revalidate; received Cache-Control: ${cacheControl}`,
        );
      const actual = Buffer.from(await response.arrayBuffer());
      if (!expected.equals(actual))
        throw new Error(
          `${url}: HTML differs from the build (stale cache or fallback page)`,
        );
      console.error(`Verified ${url}`);
    }
  }
}
if (require.main === module) {
  verifyDeployment().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { verifyDeployment };
