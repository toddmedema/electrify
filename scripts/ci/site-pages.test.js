const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
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
  sourceDate,
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

function commit(root, message, date) {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Site test",
      "-c",
      "user.email=site@example.test",
      "commit",
      "--quiet",
      "-m",
      message,
    ],
    {
      cwd: root,
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    },
  );
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
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  commit(root, "Initial authored pages", "2020-01-02T12:00:00Z");
  const sources = [
    ...STATIC_PAGES.map((page) => page.source),
    "site/scenarios.json",
    "site/templates/pages.js",
  ];
  write(
    "site/source-dates.json",
    Object.fromEntries(
      sources.map((source) => [
        source,
        {
          date: "2020-01-02",
          sha256: createHash("sha256")
            .update(fs.readFileSync(path.join(root, source)))
            .digest("hex"),
        },
      ]),
    ),
  );
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

test("sitemap dates survive editing, committing source and output together, and squash merges", async (t) => {
  const { root, write } = fixture(t);
  await generate({ root });
  const first = await buildSite({ root });
  const dates = (output) => {
    const dom = new JSDOM(output.get("public/sitemap.xml"), {
      contentType: "application/xml",
    });
    t.after(() => dom.window.close());
    return new Map(
      [...dom.window.document.querySelectorAll("url")].map((node) => [
        node.querySelector("loc").textContent,
        node.querySelector("lastmod").textContent,
      ]),
    );
  };
  assert.deepEqual(new Set(dates(first).values()), new Set(["2020-01-02"]));
  write("public/about.html", "A changed authored page");
  await assert.rejects(
    generate({ root, check: true }),
    /public\/about.html.*--date/,
  );
  await assert.rejects(generate({ root }), /public\/about.html.*--date/);
  await generate({ root, date: "2021-03-04" });
  const changed = await buildSite({ root });
  assert.equal(dates(changed).get(`${ORIGIN}/about.html`), "2021-03-04");
  assert.equal(
    dates(changed).get(`${ORIGIN}/scenarios/challenge-1.html`),
    "2020-01-02",
  );
  execFileSync("git", ["add", "."], { cwd: root });
  commit(root, "Edit authored page and regenerate", "2021-03-04T12:00:00Z");
  await generate({ root, check: true });
  execFileSync("git", ["reset", "--soft", "HEAD~1"], { cwd: root });
  commit(root, "Squash source and generated output", "2022-05-06T12:00:00Z");
  await generate({ root, check: true });
  const checkout = path.join(root, "fresh-checkout");
  execFileSync("git", ["clone", "--quiet", root, checkout]);
  await generate({ root: checkout, check: true });
  write("public/llms.txt", "stale generated output");
  execFileSync("git", ["add", "public/llms.txt"], { cwd: root });
  commit(root, "Regenerate output only", "2023-07-08T12:00:00Z");
  assert.equal(
    (await buildSite({ root })).get("public/sitemap.xml"),
    changed.get("public/sitemap.xml"),
  );
  assert.equal(sourceDate(root, ["site/scenarios.json"]), "2020-01-02");
  await generate({ root });
  assert.deepEqual((await generate({ root, date: "2024-09-10" })).changed, []);
});

test("source dates reject missing records, invalid dates, future dates and backdating", async (t) => {
  const { root, write } = fixture(t);
  write("public/about.html", "Changed content");
  for (const date of ["2021-02-29", "2021-13-01", "2999-01-01", "2019-12-31"])
    await assert.rejects(generate({ root, date }), /date/);
  await assert.rejects(
    generate({ root, check: true, date: "2021-03-04" }),
    /--date cannot be used with --check/,
  );
  write("site/source-dates.json", {});
  await assert.rejects(generate({ root, check: true }), /--date/);
});

test("pre-push checks committed site changes and skips unrelated changes", async (t) => {
  const { root, write } = fixture(t);
  await generate({ root });
  const { scripts } = require("../../package.json");
  write("package.json", {
    scripts: {
      "check:prepush": scripts["check:prepush"],
      "site:check": scripts["site:check"],
    },
  });
  for (const file of ["check-changed.js", "generate.js", "registry.js"]) {
    const relative = `scripts/site/${file}`;
    write(relative, fs.readFileSync(path.join(ROOT, relative), "utf8"));
  }
  const git = (...args) => execFileSync("git", args, { cwd: root });
  const record = (message) => {
    git("add", "-A");
    commit(root, message, "2020-01-03T12:00:00Z");
  };
  record("Generate baseline pages");
  git("update-ref", "refs/remotes/origin/master", "HEAD");
  const check = () =>
    spawnSync("npm", ["run", "check:prepush"], {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
      env: { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") },
    });

  write("README.md", "Documentation edit");
  record("Edit documentation");
  const skipped = check();
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.match(skipped.stdout, /No site inputs or generated pages changed/);

  write("public/about.html", "<!doctype html>\n<p>New authored copy</p>");
  record("Edit a public page without regenerating");
  const stale = check();
  assert.equal(stale.status, 1, stale.stdout);
  assert.match(stale.stderr, /public\/about.html has no matching source date/);
  assert.match(stale.stderr, /npm run site:generate -- --date YYYY-MM-DD/);

  await generate({ root, date: "2020-01-03" });
  const uncommitted = check();
  assert.equal(uncommitted.status, 1, uncommitted.stdout);
  assert.match(uncommitted.stderr, /Commit or set aside local site changes/);

  record("Commit regenerated site files");
  const repaired = check();
  assert.equal(repaired.status, 0, repaired.stderr);
  assert.match(repaired.stdout, /Site pages are current/);
});

test("learning pages provide breadcrumbs, concise metadata, and a substantial simulator guide", async (t) => {
  const output = await buildSite();
  for (const pathname of [
    ...STATIC_PAGES.map((page) => page.path).filter(
      (pathname) => pathname !== "/",
    ),
    "/scenarios.html",
  ]) {
    const document =
      pathname === "/scenarios.html"
        ? new JSDOM(output.get("public/scenarios.html")).window.document
        : readStaticPage(pathname, t);
    if (pathname === "/scenarios.html")
      t.after(() => document.defaultView.close());
    assert.ok(document.title.length <= 60, `${pathname}: title length`);
    const description = document.querySelector(
      'meta[name="description"]',
    ).content;
    assert.ok(
      description.length >= 70 && description.length <= 155,
      `${pathname}: description length ${description.length}`,
    );
    const entities = [
      ...document.querySelectorAll('script[type="application/ld+json"]'),
    ].map((script) => JSON.parse(script.textContent));
    const breadcrumbs = entities
      .flatMap((entity) => [entity, entity.breadcrumb])
      .find((entity) => entity?.["@type"] === "BreadcrumbList");
    assert.ok(breadcrumbs, `${pathname}: breadcrumb data`);
    assert.deepEqual(
      breadcrumbs.itemListElement.map((item) => item.item),
      [ORIGIN + "/", ORIGIN + pathname],
    );
    assert.ok(
      document.querySelector('nav[aria-label="Breadcrumb"] a[href="/"]'),
      `${pathname}: visible hierarchy`,
    );
  }
  const document = readStaticPage("/power-grid-simulator.html", t);
  assert.equal(document.querySelectorAll("h1").length, 1);
  assert.ok(document.querySelectorAll("main h2").length >= 4);
  assert.ok(
    document.querySelector("main").textContent.trim().split(/\s+/).length >=
      600,
  );
  assert.ok(
    new Set(
      [...document.querySelectorAll('main a[href^="/scenarios/"]')].map(
        (anchor) => anchor.href,
      ),
    ).size >= 4,
  );
  assert.ok(document.querySelectorAll("main h3").length >= 4);
  const image = document.querySelector(".learning-screenshot img");
  assert.equal(image.width, 1200);
  assert.equal(image.height, 630);
  for (const candidate of image.srcset.split(",")) {
    const [url, width] = candidate.trim().split(/\s+/);
    assert.match(url, /\.webp$/);
    assert.match(width, /^(400|800|1200)w$/);
    assert.ok(
      fs.statSync(path.join(ROOT, "public", url)).size <
        fs.statSync(path.join(ROOT, "public/images/gameplay-preview.png")).size,
    );
  }
  assert.ok(image.sizes);
});

test("every sitemap page receives links from four distinct pages, including descriptive scenario guide links", async (t) => {
  const output = await buildSite();
  const paths = [
    ...STATIC_PAGES.map((page) => page.path),
    "/scenarios.html",
    ...JSON.parse(fs.readFileSync(path.join(ROOT, "site/scenarios.json"))).map(
      scenarioPath,
    ),
  ];
  const inbound = new Map(paths.map((pathname) => [pathname, new Set()]));
  for (const pathname of paths) {
    const document = output.has(`public${pathname}`)
      ? new JSDOM(output.get(`public${pathname}`), { url: ORIGIN + pathname })
          .window.document
      : readStaticPage(pathname, t);
    if (output.has(`public${pathname}`))
      t.after(() => document.defaultView.close());
    for (const anchor of document.querySelectorAll("a[href]")) {
      const url = new URL(anchor.href);
      if (url.origin === ORIGIN && url.pathname !== pathname)
        inbound.get(url.pathname)?.add(pathname);
    }
    if (pathname.startsWith("/scenarios/")) {
      assert.equal(
        document.querySelectorAll('.scenario-related a[href^="/scenarios/"]')
          .length,
        3,
      );
      assert.ok(
        [
          ...document.querySelectorAll(
            'main a[href="/power-grid-simulator.html"]',
          ),
        ].some((anchor) => /power grid simulator/i.test(anchor.textContent)),
        pathname,
      );
    }
  }
  for (const [pathname, sources] of inbound)
    assert.ok(
      sources.size >= 4,
      `${pathname}: only ${sources.size} distinct inbound pages`,
    );
});
