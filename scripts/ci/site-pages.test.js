const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
// Use the HTML parser already supplied by CRA's test environment.
const { JSDOM } = require(
  require.resolve("jsdom", {
    paths: [path.dirname(require.resolve("jest-environment-jsdom"))],
  }),
);
const {
  MARKER,
  validatePages,
  buildSite,
  generate,
  playUrl,
  scenarioPath,
} = require("../site/generate");
const { ORIGIN, STATIC_PAGES } = require("../site/registry");

const ROOT = path.resolve(__dirname, "../..");

function readStaticPage(pathname, t) {
  const source = fs.readFileSync(
    path.join(ROOT, "public", pathname === "/" ? "index.html" : pathname),
    "utf8",
  );
  const dom = new JSDOM(source.replaceAll("%PUBLIC_URL%", ""), {
    url: ORIGIN + pathname,
  });
  t.after(() => dom.window.close());
  return dom.window.document;
}

test("entry pages identify their canonical URL and keep search and share metadata consistent", (t) => {
  const titles = new Set();
  for (const { path: pathname } of STATIC_PAGES) {
    const document = readStaticPage(pathname, t);
    assert.ok(document.title.trim(), pathname);
    assert.ok(!titles.has(document.title), `duplicate title: ${pathname}`);
    titles.add(document.title);
    const description = document.querySelector('meta[name="description"]');
    assert.ok(description?.content.trim(), pathname);
    const canonical = document.querySelectorAll('link[rel="canonical"]');
    assert.equal(canonical.length, 1, pathname);
    assert.equal(canonical[0].href, ORIGIN + pathname, pathname);
    for (const [selector, expected] of [
      ['meta[property="og:title"]', document.title],
      ['meta[name="twitter:title"]', document.title],
      ['meta[property="og:description"]', description.content],
      ['meta[name="twitter:description"]', description.content],
      ['meta[property="og:url"]', ORIGIN + pathname],
    ])
      assert.equal(
        document.querySelector(selector)?.content,
        expected,
        `${pathname}: ${selector}`,
      );
  }
});

test("the homepage and learning resources expose crawlable paths to play and learn", (t) => {
  const home = readStaticPage("/", t);
  for (const pathname of [
    "/about.html",
    "/power-grid-simulator.html",
    "/classroom.html",
    "/scenarios.html",
  ]) {
    assert.ok(home.querySelector(`main a[href="${pathname}"]`), pathname);
    assert.ok(fs.existsSync(path.join(ROOT, "public", pathname)), pathname);
  }
  for (const pathname of [
    "/power-grid-simulator.html",
    "/classroom.html",
    "/energy-simulators.html",
  ]) {
    const document = readStaticPage(pathname, t);
    assert.ok(
      document.querySelector('main a[href="/scenarios.html"]'),
      pathname,
    );
    assert.ok(document.querySelector('a[href="/"]'), pathname);
  }
});

test("the About page describes the same website and game as the homepage", (t) => {
  const home = readStaticPage("/", t);
  const about = readStaticPage("/about.html", t);
  const homeEntities = JSON.parse(
    home.querySelector('script[type="application/ld+json"]').textContent,
  )["@graph"];
  const schema = JSON.parse(
    about.querySelector('script[type="application/ld+json"]').textContent,
  );
  assert.equal(schema["@type"], "AboutPage");
  assert.equal(schema.url, about.querySelector('link[rel="canonical"]').href);
  assert.equal(schema.name, about.title);
  for (const [relationship, type] of [
    ["isPartOf", "WebSite"],
    ["about", "VideoGame"],
  ])
    assert.equal(
      schema[relationship]["@id"],
      homeEntities.find((entity) => entity["@type"] === type)["@id"],
    );
});

function scenario(scenarioId, overrides = {}) {
  return {
    scenarioId,
    slug: `challenge-${scenarioId}`,
    name: `Challenge ${scenarioId}`,
    location: "A test utility",
    startingYear: 2020,
    durationYears: 12,
    theme: "Energy transition",
    icon: "/images/test icon.svg",
    dek: "Keep the lights on while replacing old power plants.",
    description: "Run a utility through a changing electricity market.",
    setup: ["You start with an aging fleet and enough cash to make a choice."],
    decisions: [
      {
        title: "Choose what to build",
        body: "Keep enough capacity in reserve.",
      },
    ],
    takeaway: "A cheap power plant can still make expensive electricity.",
    related: [scenarioId === 1 ? 2 : 1],
    ...overrides,
  };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "electrify-site-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, value) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  for (const page of STATIC_PAGES)
    write(
      `public${page.path === "/" ? "/index.html" : page.path}`,
      "<!doctype html>",
    );
  write(
    "public/images/test icon.svg",
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  write(
    "site/templates/pages.js",
    `module.exports = require(${JSON.stringify(path.join(ROOT, "site/templates/pages.js"))});`,
  );
  const pages = [scenario(1), scenario(2)];
  write("site/scenarios.json", pages);
  return { root, pages, write, publicDir: path.join(root, "public") };
}

test("scenario content rejects duplicate identity, broken references and missing assets", (t) => {
  const { publicDir, pages } = fixture(t);
  assert.equal(validatePages(pages, { publicDir }), pages);
  for (const [name, mutate, message] of [
    ["duplicate IDs", (p) => (p[1].scenarioId = 1), /duplicate scenarioId/],
    ["duplicate slugs", (p) => (p[1].slug = p[0].slug), /duplicate slug/],
    ["path traversal", (p) => (p[0].slug = "../elsewhere"), /slug/],
    ["empty copy", (p) => (p[0].dek = ""), /dek/],
    ["unknown field", (p) => (p[0].descripton = "typo"), /unknown field/],
    ["negative duration", (p) => (p[0].durationYears = -1), /durationYears/],
    ["invalid kind", (p) => (p[0].kind = "legacy"), /kind/],
    ["missing decision", (p) => (p[0].decisions = []), /decisions/],
    ["missing relation", (p) => (p[0].related = [999]), /invalid related/],
    ["self relation", (p) => (p[0].related = [1]), /invalid related/],
    ["duplicate relations", (p) => (p[0].related = [2, 2]), /distinct/],
    [
      "missing icon",
      (p) => (p[0].icon = "/images/missing.svg"),
      /existing SVG/,
    ],
    [
      "external icon",
      (p) => (p[0].icon = "https://example.com/x.svg"),
      /existing SVG/,
    ],
    ["icon traversal", (p) => (p[0].icon = "/images/../x.svg"), /existing SVG/],
  ]) {
    const invalid = structuredClone(pages);
    mutate(invalid);
    assert.throws(() => validatePages(invalid, { publicDir }), message, name);
  }
});

test("authored text remains text in metadata, HTML and structured data", async (t) => {
  const { root, pages } = fixture(t);
  const hostile =
    '</script><script>alert("test")</script><b data-x="1"> & \'quoted\'';
  pages[0] = scenario(1, {
    name: hostile,
    location: hostile,
    theme: hostile,
    dek: hostile,
    description: hostile,
    setup: [hostile],
    decisions: [{ title: hostile, body: hostile }],
    takeaway: hostile,
  });
  const output = await buildSite({ root, pages });
  for (const relative of [
    "public/scenarios.html",
    `public${scenarioPath(pages[0])}`,
  ]) {
    const dom = new JSDOM(output.get(relative));
    t.after(() => dom.window.close());
    const document = dom.window.document;
    assert.equal(document.querySelectorAll("b[data-x]").length, 0);
    for (const script of document.querySelectorAll("script:not([src])")) {
      assert.equal(script.type, "application/ld+json");
      assert.doesNotThrow(() => JSON.parse(script.textContent));
    }
  }
  const dom = new JSDOM(output.get(`public${scenarioPath(pages[0])}`));
  t.after(() => dom.window.close());
  assert.equal(
    dom.window.document
      .querySelector("h1")
      .textContent.trim()
      .replace(/\s+/g, " "),
    hostile,
  );
  assert.equal(
    dom.window.document.querySelector('meta[name="description"]').content,
    hostile,
  );
});

test("every scenario has a crawlable directory link, canonical URL, structured data and sitemap entry", async (t) => {
  const output = await buildSite();
  const pages = JSON.parse(
    fs.readFileSync(path.join(ROOT, "site/scenarios.json")),
  );
  const index = new JSDOM(output.get("public/scenarios.html"), {
    url: `${ORIGIN}/scenarios.html`,
  });
  t.after(() => index.window.close());
  const xml = new JSDOM(output.get("public/sitemap.xml"), {
    contentType: "application/xml",
  });
  t.after(() => xml.window.close());
  const listedUrls = Array.from(
    xml.window.document.querySelectorAll("loc"),
    (node) => node.textContent,
  );
  assert.equal(new Set(listedUrls).size, listedUrls.length);
  for (const page of pages) {
    const pathname = scenarioPath(page);
    const url = ORIGIN + pathname;
    assert.ok(
      index.window.document.querySelector(`a[href="${pathname}"]`),
      pathname,
    );
    assert.ok(listedUrls.includes(url), url);
    assert.ok(output.get("public/llms.txt").includes(url));
    const dom = new JSDOM(output.get(`public${pathname}`), { url });
    t.after(() => dom.window.close());
    const document = dom.window.document;
    assert.equal(document.querySelectorAll("h1").length, 1);
    assert.equal(document.querySelector('link[rel="canonical"]').href, url);
    assert.equal(
      document.querySelector('meta[property="og:url"]').content,
      url,
    );
    assert.equal(
      document.querySelector('meta[name="description"]').content,
      page.description,
    );
    assert.ok(document.querySelector(`a[href="${playUrl(page)}"]`));
    assert.ok(document.querySelector('a[href="/scenarios.html"]'));
    assert.ok(
      document.querySelector('footer a[href="/power-grid-simulator.html"]'),
    );
    for (const related of page.related) {
      const relatedPage = pages.find(
        (candidate) => candidate.scenarioId === related,
      );
      assert.ok(
        document.querySelector(`a[href="${scenarioPath(relatedPage)}"]`),
      );
    }
    const structured = document.querySelectorAll(
      'script[type="application/ld+json"]',
    );
    assert.ok(structured.length > 0);
    for (const element of structured)
      assert.doesNotThrow(() => JSON.parse(element.textContent));
    for (const anchor of document.querySelectorAll("a[href]")) {
      const link = new URL(anchor.href);
      if (link.origin !== ORIGIN) continue;
      const relative = `public${link.pathname === "/" ? "/index.html" : decodeURIComponent(link.pathname)}`;
      assert.ok(
        output.has(relative) || fs.existsSync(path.join(ROOT, relative)),
        `broken link: ${anchor.href}`,
      );
    }
    for (const image of document.querySelectorAll("img[src]")) {
      const link = new URL(image.src);
      if (link.origin !== ORIGIN) continue;
      assert.ok(
        fs.existsSync(
          path.join(ROOT, "public", decodeURIComponent(link.pathname)),
        ),
        `missing image: ${image.src}`,
      );
    }
  }
  assert.equal(
    playUrl(scenario(120, { kind: "campaign" })),
    "/?campaign=legacy",
  );
});

test("generation is deterministic, catches drift, and removes retired generated pages", async (t) => {
  const { root, write } = fixture(t);
  await assert.rejects(generate({ root, check: true }), /stale/);
  await generate({ root });
  const target = path.join(root, "public/scenarios/challenge-1.html");
  const before = fs.statSync(target).mtimeMs;
  assert.deepEqual((await generate({ root })).changed, []);
  assert.equal(fs.statSync(target).mtimeMs, before);
  await generate({ root, check: true });
  write("public/scenarios/challenge-1.html", "outdated output");
  await assert.rejects(generate({ root, check: true }), /challenge-1.html/);
  await generate({ root });
  write("public/scenarios/retired.html", MARKER);
  await assert.rejects(generate({ root, check: true }), /retired.html/);
  await generate({ root });
  assert.equal(
    fs.existsSync(path.join(root, "public/scenarios/retired.html")),
    false,
  );
  write("public/scenarios/unmanaged.html", "hand-authored page");
  await assert.rejects(generate({ root }), /unmanaged file/);
});

test("checked-in site pages are current", async () => {
  await generate({ check: true });
});
