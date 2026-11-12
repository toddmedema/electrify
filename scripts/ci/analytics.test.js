const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM, ResourceLoader } = require(
  require.resolve("jsdom", {
    paths: [path.dirname(require.resolve("jest-environment-jsdom"))],
  }),
);

const ROOT = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(ROOT, "public/analytics.js"), "utf8");
const STREAM = "G-M064W1XFDY";

function browser(
  t,
  {
    online = true,
    url = "https://electrifygame.com/",
    native,
    readyState = "complete",
  } = {},
) {
  const dom = new JSDOM(
    "<!doctype html><html><head></head><body></body></html>",
    {
      url,
      runScripts: "outside-only",
    },
  );
  t.after(() => dom.window.close());
  const { window } = dom;
  Object.defineProperty(window.document, "readyState", {
    get: () => readyState,
  });
  let now = 0;
  let nextTimer = 0;
  const timers = new Map();
  window.Date.now = () => now;
  window.setTimeout = (callback) => {
    timers.set(++nextTimer, callback);
    return nextTimer;
  };
  window.clearTimeout = (timer) => timers.delete(timer);
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
  if (native) window[native] = { apiVersion: 1 };
  const run = () => window.eval(source);
  const scripts = () =>
    Array.from(window.document.querySelectorAll("script[src]"));
  const commands = () =>
    Array.from(window.dataLayer || [], (command) => Array.from(command));
  return {
    window,
    run,
    scripts,
    commands,
    ready: () => {
      readyState = "interactive";
      window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
    },
    online: (value) => {
      online = value;
      window.dispatchEvent(new window.Event(value ? "online" : "offline"));
    },
    expire: () => {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const callback of callbacks) callback();
    },
    advance: () => (now += 30000),
  };
}

test("a browser document configures the game stream once, including repeated startup", (t) => {
  const b = browser(t);
  b.run();
  const api = b.window.electrifyAnalytics;
  b.run();
  api.initialize();
  assert.equal(b.window.electrifyAnalytics, api);
  assert.equal(b.scripts().length, 1);
  const script = b.scripts()[0];
  assert.equal(script.async, true);
  assert.equal(new URL(script.src).searchParams.get("id"), STREAM);
  assert.deepEqual(
    b.commands().map((command) => command.slice(0, 2)),
    [
      ["js", b.window.dataLayer[0][1]],
      ["config", STREAM],
    ],
  );
  script.dispatchEvent(new b.window.Event("load"));
  api.initialize();
  assert.equal(b.commands().filter(([name]) => name === "config").length, 1);
});

test("early custom events keep names, parameters and order, and work through a dropout", (t) => {
  const b = browser(t);
  b.run();
  const api = b.window.electrifyAnalytics;
  const params = { card: "MANUAL", app_version: "test-version" };
  api.logEvent("scenario_start", { scenario: 108 });
  api.logEvent("card_view", params);
  assert.equal(b.commands().length, 2);
  b.scripts()[0].dispatchEvent(new b.window.Event("load"));
  b.online(false);
  api.logEvent("card_view", { card: "FACILITIES" });
  assert.deepEqual(b.commands().slice(2), [
    ["event", "scenario_start", { scenario: 108 }],
    ["event", "card_view", params],
    ["event", "card_view", { card: "FACILITIES" }],
  ]);
});

test("async runtime waits for page metadata and adopts earlier game events once", (t) => {
  const b = browser(t, { readyState: "loading" });
  b.window.electrifyAnalyticsQueue = [
    {
      name: "scenario_start",
      params: { id: 107, app_version: "early-version" },
    },
    {
      name: "card_view",
      params: { card: "MANUAL", app_version: "early-version" },
    },
  ];
  b.run();
  assert.equal(b.window.electrifyAnalyticsQueue, undefined);
  b.window.electrifyAnalytics.initialize();
  b.window.electrifyAnalytics.logEvent("card_view", { card: "FACILITIES" });
  assert.equal(b.scripts().length, 0);
  assert.equal(b.commands().length, 0);
  const title = "Full page title parsed after the async script";
  b.window.document.title = title;
  const append = b.window.document.head.appendChild;
  b.window.document.head.appendChild = function (script) {
    assert.equal(b.window.document.title, title);
    assert.equal(b.window.document.readyState, "interactive");
    assert.equal(b.commands().filter(([name]) => name === "config").length, 1);
    return append.call(this, script);
  };
  b.ready();
  b.scripts()[0].dispatchEvent(new b.window.Event("load"));
  b.run();
  b.window.electrifyAnalytics.initialize();
  assert.equal(b.commands().filter(([name]) => name === "config").length, 1);
  assert.deepEqual(b.commands().slice(2), [
    ["event", "scenario_start", { id: 107, app_version: "early-version" }],
    ["event", "card_view", { card: "MANUAL", app_version: "early-version" }],
    ["event", "card_view", { card: "FACILITIES" }],
  ]);
});

test("adopted events share the runtime's bounded queue", (t) => {
  const b = browser(t);
  b.window.electrifyAnalyticsQueue = Array.from({ length: 100 }, (_, i) => ({
    name: "card_view",
    params: { i },
  }));
  b.run();
  b.window.electrifyAnalytics.logEvent("overflow", { i: 100 });
  b.scripts()[0].dispatchEvent(new b.window.Event("load"));
  assert.equal(b.commands().length, 102);
  assert.equal(b.commands().at(-1)[2].i, 99);
});

test("offline startup waits for recovery and flushes early events without duplicate config", (t) => {
  const b = browser(t, { online: false });
  b.run();
  b.window.electrifyAnalytics.logEvent("card_view", { card: "MANUAL" });
  assert.equal(b.scripts().length, 0);
  assert.equal(b.commands().length, 0);
  b.online(true);
  assert.equal(b.scripts().length, 1);
  b.scripts()[0].dispatchEvent(new b.window.Event("load"));
  assert.equal(b.commands()[1][1], STREAM);
  assert.deepEqual(b.commands()[2], ["event", "card_view", { card: "MANUAL" }]);
});

test("blocked tags retry on recovery or a later event with a bounded pending queue", (t) => {
  const b = browser(t);
  b.run();
  b.scripts()[0].dispatchEvent(new b.window.Event("error"));
  const api = b.window.electrifyAnalytics;
  for (let i = 0; i < 1000; i++) api.logEvent("card_view", { i });
  assert.equal(
    b.scripts().length,
    0,
    "do not retry a blocked tag for every event",
  );
  assert.equal(
    b.commands().length,
    2,
    "pending events do not grow the dataLayer",
  );
  b.advance();
  api.logEvent("retry");
  assert.equal(b.scripts().length, 1);
  b.scripts()[0].dispatchEvent(new b.window.Event("error"));
  b.online(true);
  assert.equal(b.scripts().length, 1, "connectivity recovery bypasses backoff");
  b.scripts()[0].dispatchEvent(new b.window.Event("load"));
  assert.equal(b.commands().length, 102);
  assert.deepEqual(
    b
      .commands()
      .slice(2)
      .map((command) => command[2].i),
    Array.from({ length: 100 }, (_, i) => i),
  );
  assert.equal(b.commands().filter(([name]) => name === "config").length, 1);
});

test("a stalled tag times out, and stale load callbacks cannot duplicate initialization", (t) => {
  const b = browser(t);
  b.run();
  const stalled = b.scripts()[0];
  b.expire();
  assert.equal(b.scripts().length, 0);
  b.online(true);
  const retry = b.scripts()[0];
  stalled.dispatchEvent(new b.window.Event("load"));
  b.window.electrifyAnalytics.logEvent("card_view");
  assert.equal(b.commands().length, 2);
  retry.dispatchEvent(new b.window.Event("load"));
  assert.equal(b.commands().length, 3);
});

test("DOM and tag failures remain optional and retryable", (t) => {
  const b = browser(t);
  const head = b.window.document.head;
  const append = head.appendChild;
  head.appendChild = () => {
    throw new Error("blocked");
  };
  assert.doesNotThrow(b.run);
  head.appendChild = append;
  b.online(true);
  assert.equal(b.scripts().length, 1);
  b.scripts()[0].dispatchEvent(new b.window.Event("load"));
  b.window.gtag = () => {
    throw new Error("transport failed");
  };
  assert.doesNotThrow(() => b.window.electrifyAnalytics.logEvent("card_view"));
});

for (const options of [
  { url: "electrify://app/index.html" },
  { url: "file:///game/index.html" },
  { native: "electrifyDesktop" },
  { native: "electrifyCouch" },
]) {
  test(`native contexts stay analytics-free: ${JSON.stringify(options)}`, (t) => {
    const b = browser(t, options);
    b.run();
    b.window.electrifyAnalytics.initialize();
    b.window.electrifyAnalytics.logEvent("launch");
    b.online(true);
    assert.equal(b.scripts().length, 0);
    assert.equal(b.commands().length, 0);
  });
}

test("non-browser execution has no analytics globals or transport", () => {
  const context = {};
  assert.doesNotThrow(() => vm.runInNewContext(source, context));
  assert.deepEqual(context, {});
});

test("a stalled local runtime does not delay game document startup", async (t) => {
  let release;
  class DelayedAnalytics extends ResourceLoader {
    fetch(url) {
      if (new URL(url).pathname === "/analytics.js") {
        const response = new Promise((resolve) => {
          release = () => resolve(Buffer.from(source));
        });
        response.abort = () => {};
        return response;
      }
      // All other resources, including Google, stay local and network-free.
      return null;
    }
  }
  const dom = new JSDOM(
    fs
      .readFileSync(path.join(ROOT, "public/index.html"), "utf8")
      .replaceAll("%PUBLIC_URL%", ""),
    {
      url: "https://electrifygame.com/",
      runScripts: "dangerously",
      resources: new DelayedAnalytics(),
    },
  );
  t.after(async () => {
    release?.();
    await new Promise((resolve) => setImmediate(resolve));
    dom.window.close();
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.notEqual(dom.window.document.readyState, "loading");
  assert.ok(dom.window.document.documentElement.classList.contains("js"));
  assert.equal(dom.window.document.documentElement.dataset.theme, "light");
  assert.ok(dom.window.document.querySelector("#root"));
  assert.equal(dom.window.electrifyAnalytics, undefined);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(dom.window.electrifyAnalytics);
});

function assertAnalyticsDocument(document, name) {
  const scripts = Array.from(document.querySelectorAll("script[src]"));
  const shared = scripts.filter((script) =>
    ["/analytics.js", "%PUBLIC_URL%/analytics.js"].includes(
      script.getAttribute("src"),
    ),
  );
  assert.equal(shared.length, 1, `${name}: one shared analytics runtime`);
  assert.ok(
    shared[0].parentElement === document.head,
    `${name}: initialize on page load`,
  );
  assert.ok(
    shared[0].hasAttribute("async") || shared[0].hasAttribute("defer"),
    `${name}: analytics must not block document parsing`,
  );
  assert.ok(
    !scripts.some((script) => /googletagmanager\.com/.test(script.src)),
    `${name}: Google tag is owned by the shared runtime`,
  );
  if (name !== "index.html")
    assert.equal(
      document.querySelectorAll(
        'script:not([src]):not([type="application/ld+json"])',
      ).length,
      0,
      `${name}: no copied inline bootstrap`,
    );
}

function htmlFiles(root, relative = "") {
  return fs
    .readdirSync(path.join(root, relative), { withFileTypes: true })
    .flatMap((entry) => {
      const name = path.join(relative, entry.name);
      return entry.isDirectory()
        ? htmlFiles(root, name)
        : name.endsWith(".html")
          ? [name]
          : [];
    });
}

test("every public HTML page uses the same runtime, including generated pages and privacy", (t) => {
  const publicRoot = path.join(ROOT, "public");
  for (const name of htmlFiles(publicRoot)) {
    const dom = new JSDOM(fs.readFileSync(path.join(publicRoot, name), "utf8"));
    t.after(() => dom.window.close());
    assertAnalyticsDocument(dom.window.document, name);
  }
});

test("the document guard rejects blocking, missing, duplicate and copied tags", (t) => {
  const valid = '<head><script async src="/analytics.js"></script></head>';
  const dom = new JSDOM(valid);
  t.after(() => dom.window.close());
  assert.doesNotThrow(() =>
    assertAnalyticsDocument(dom.window.document, "privacy.html"),
  );
  for (const invalid of [
    valid.replace(" async", ""),
    "<head></head>",
    valid.replace("</head>", '<script src="/analytics.js"></script></head>'),
    valid.replace(
      "</head>",
      '<script src="https://www.googletagmanager.com/gtag/js?id=G-OTHER"></script></head>',
    ),
    valid.replace(
      "</head>",
      '<script>gtag("config", "G-OTHER");</script></head>',
    ),
  ]) {
    const broken = new JSDOM(invalid);
    t.after(() => broken.window.close());
    assert.throws(
      () => assertAnalyticsDocument(broken.window.document, "privacy.html"),
      /block document parsing|shared analytics|owned by|inline bootstrap/,
    );
  }
});
