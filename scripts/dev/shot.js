// `npm run shot`: small headless screenshots of the running app, for agents and reviewers.
//
// This file only parses and validates the command line and finds the app to photograph. The
// browser work lives in e2e/shot.run.ts, which reuses the e2e fixtures and navigation helpers
// (cloud-save marker, openPane, openBuild) through the Playwright runner, so a layout change
// that updates those helpers updates screenshots too.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { alive, coordinationRoot, readOwner } = require("./coordination");

const VIEWS = [
  "facilities",
  "build",
  "programs",
  "insights",
  "events",
  "scenario",
];
const THEMES = ["light", "dark"];
const DEFAULT_SCENARIO = 108;
const DEFAULT_OUT = path.join(".tmp", "shots");

const USAGE = `Usage: npm run shot -- [options]

Starts a scenario in headless Chromium, opens a view, and writes small PNGs (device scale 1).
One line per file is printed: absolute path, pixel size, file size.

  --scenario <id>       Scenario to start (default ${DEFAULT_SCENARIO}).
  --view <name>         ${VIEWS.join(" | ")} (default facilities).
  --viewports <list>    Comma-separated widths, or WxH (default 1280). 390 and 360 emulate
                        phones; 1280 and 768 use the e2e project sizes.
  --theme <list>        light, dark, or light,dark (default light).
  --clip <selector>     Capture only the first element matching this Playwright selector,
                        e.g. ".facilityRow:has-text('Solar')". Smaller than a full viewport.
  --full-page           Capture the whole scrollable page instead of the viewport.
  --url <path>          Photograph an arbitrary route such as /manual instead of a started
                        game. Add --view to start the game from that route and open a view.
  --out <dir>           Output directory (default ${DEFAULT_OUT.replaceAll("\\", "/")}, git-ignored).
  --name <prefix>       File name prefix (default: scenario, view, --clip and --full-page, or
                        the route), so shots of different components do not overwrite each other.
  --delay <ms>          Wait this long before capturing (default 300).
  --base-url <url>      App to photograph. Otherwise E2E_BASE_URL, BASE_URL, or the dev server
                        that "npm start" is running in this checkout. Must use the origin root.

Files are named <name>-<viewport>-<theme>.png. The game is paused while it is captured. Each new
game draws random weather, so figures such as reserve and income differ between runs: compare
layout, not values.

Start the app first, in the background: npm start (it prints "Reserved E2E_PORT=<port>").`;

class UsageError extends Error {
  /** `usage` adds a pointer to --help; environment problems are not usage mistakes. */
  constructor(message, usage = true) {
    super(message);
    this.usage = usage;
  }
}

const VALUE_OPTIONS = new Set([
  "scenario",
  "view",
  "url",
  "viewports",
  "theme",
  "clip",
  "out",
  "name",
  "base-url",
  "delay",
]);
const FLAG_OPTIONS = new Set(["full-page", "help"]);
const ALIASES = { viewport: "viewports", themes: "theme" };

function integer(name, value, min, max) {
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)
    throw new UsageError(
      `--${name} must be a whole number from ${min} to ${max}`,
    );
  return Number(value);
}

function list(name, value, allowed) {
  const items = [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  if (!items.length) throw new UsageError(`--${name} needs at least one value`);
  const unknown = items.find((item) => !allowed.includes(item));
  if (unknown)
    throw new UsageError(
      `--${name} has unknown value "${unknown}" (use ${allowed.join(", ")})`,
    );
  return items;
}

function viewportList(value) {
  const seen = new Set();
  const viewports = [];
  for (const item of value.split(",").map((part) => part.trim())) {
    const match = /^(\d+)(?:x(\d+))?$/.exec(item);
    if (!match)
      throw new UsageError(
        `--viewports entry "${item}" must be a width (390) or WxH (390x700)`,
      );
    const width = integer("viewports width", match[1], 200, 3840);
    const height =
      match[2] === undefined
        ? undefined
        : integer("viewports height", match[2], 200, 4000);
    const label = height === undefined ? `${width}` : `${width}x${height}`;
    if (seen.has(label)) continue;
    seen.add(label);
    viewports.push({ width, height, label });
  }
  return viewports;
}

function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function captureSlug(text) {
  // Keep paths readable without letting truncation or punctuation merge distinct captures.
  return `${slug(text)}-${createHash("sha256").update(text).digest("hex").slice(0, 12)}`;
}

function isAppRoute(route) {
  const origin = "http://electrify.invalid";
  try {
    return (
      /^\/(?![\\/])/.test(route) &&
      !/[\t\r\n]/.test(route) &&
      new URL(route, origin).origin === origin
    );
  } catch {
    return false;
  }
}

/** Turn argv into a validated request. Pure: no environment, network or file access. */
function parseShotArgs(argv, { cwd = process.cwd() } = {}) {
  const raw = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--") continue;
    const match = /^--([a-z][a-z-]*)(?:=([\s\S]*))?$/.exec(arg);
    if (!match) throw new UsageError(`unexpected argument "${arg}"`);
    const key = ALIASES[match[1]] ?? match[1];
    const inline = match[2];
    if (FLAG_OPTIONS.has(key)) {
      if (inline !== undefined)
        throw new UsageError(`--${key} does not take a value`);
      raw[key] = true;
    } else if (VALUE_OPTIONS.has(key)) {
      const value = inline ?? argv[index + 1];
      if (
        value === undefined ||
        (inline === undefined && /^--[a-z]/.test(value))
      )
        throw new UsageError(`--${key} needs a value`);
      if (inline === undefined) index++;
      raw[key] = value;
    } else throw new UsageError(`unknown option --${match[1]}`);
  }
  if (raw.help) return { help: true };

  const hasUrl = raw.url !== undefined;
  if (hasUrl && raw.scenario !== undefined)
    throw new UsageError("use either --scenario or --url, not both");
  if (raw.clip !== undefined && raw["full-page"])
    throw new UsageError("--clip and --full-page cannot be combined");
  if (hasUrl && !isAppRoute(raw.url))
    throw new UsageError('--url must be a route on the app starting with "/"');
  if (raw.clip !== undefined && !raw.clip.trim())
    throw new UsageError("--clip needs a non-empty selector");
  const scenario =
    raw.scenario === undefined
      ? DEFAULT_SCENARIO
      : integer("scenario", raw.scenario, 0, 100000);
  const view = raw.view ?? "facilities";
  if (!VIEWS.includes(view))
    throw new UsageError(`--view must be one of ${VIEWS.join(", ")}`);
  // A bare route is photographed as is; naming a view asks to start the game and open it.
  const game = !hasUrl || raw.view !== undefined;
  // Distinct captures of one view (another clip, full page) must not share a file name: parallel
  // agents in one checkout would otherwise overwrite each other's evidence.
  const derived = [
    hasUrl
      ? `url-${captureSlug(raw.url)}${game ? `-${view}` : ""}`
      : `s${scenario}-${view}`,
    raw.clip === undefined ? "" : captureSlug(raw.clip),
    raw["full-page"] ? "full" : "",
  ]
    .filter(Boolean)
    .join("-");
  const name = raw.name === undefined ? derived : slug(raw.name);
  if (!name) throw new UsageError("--name needs letters or digits");
  return {
    help: false,
    route: hasUrl ? raw.url : `/?scenario=${scenario}`,
    game,
    view,
    viewports: viewportList(raw.viewports ?? "1280"),
    themes: list("theme", raw.theme ?? "light", THEMES),
    clip: raw.clip,
    fullPage: !!raw["full-page"],
    outDir: path.resolve(cwd, raw.out ?? DEFAULT_OUT),
    name,
    delay:
      raw.delay === undefined ? 300 : integer("delay", raw.delay, 0, 30000),
    baseUrl: raw["base-url"],
  };
}

function normalizeBaseUrl(text, source) {
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new UsageError(`${source} is not a URL: ${text}`, false);
  }
  if (!/^https?:$/.test(url.protocol))
    throw new UsageError(`${source} must be an http(s) URL: ${text}`, false);
  if (url.pathname !== "/")
    throw new UsageError(
      `${source} must use the origin root without a subpath: ${text}`,
      false,
    );
  return url.origin;
}

/** Ports that a live command in this checkout reserved (npm start, check, browser runs). */
function leasedPorts(root, coordinationDir) {
  let entries;
  try {
    entries = fs.readdirSync(coordinationDir);
  } catch {
    return [];
  }
  const real = (target) => {
    try {
      return fs.realpathSync(target);
    } catch {
      return path.resolve(target);
    }
  };
  const here = real(root);
  return entries
    .flatMap((entry) => {
      const match = /^port-(\d+)$/.exec(entry);
      if (!match) return [];
      let owner;
      try {
        owner = readOwner(path.join(coordinationDir, entry));
      } catch {
        return [];
      }
      if (
        !owner ||
        typeof owner.cwd !== "string" ||
        real(owner.cwd) !== here ||
        (!alive(owner.pid) && !alive(owner.childPid))
      )
        return [];
      return [
        { port: Number(match[1]), startedAt: Date.parse(owner.startedAt) || 0 },
      ];
    })
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(({ port }) => port);
}

async function reachable(url, timeoutMs = 5000) {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

const NO_SERVER =
  'no running app found for this checkout. Start one in the background with "npm start" ' +
  '(it prints "Reserved E2E_PORT=<port>"), then rerun; or pass --base-url / set E2E_BASE_URL.';

/**
 * Pick the app to photograph. An explicit URL always wins. Otherwise only a server that a
 * command running in this checkout reserved a port for is used: a dev server left running by
 * another checkout would silently show the wrong code.
 */
async function resolveBaseUrl({
  flag,
  env = process.env,
  root = path.resolve(__dirname, "..", ".."),
  coordinationDir = coordinationRoot(),
  probe = reachable,
} = {}) {
  const explicit = [
    ["--base-url", flag],
    ["E2E_BASE_URL", env.E2E_BASE_URL],
    ["BASE_URL", env.BASE_URL],
  ].find(([, value]) => value !== undefined);
  if (explicit) {
    const url = normalizeBaseUrl(explicit[1], explicit[0]);
    if (!(await probe(url)))
      throw new UsageError(
        `cannot reach ${url} (from ${explicit[0]}). Start the app with "npm start" or fix the URL.`,
        false,
      );
    return { url, source: explicit[0] };
  }
  for (const port of leasedPorts(root, coordinationDir)) {
    const url = `http://127.0.0.1:${port}`;
    if (await probe(url, 3000))
      return { url, source: "this checkout's running server" };
  }
  throw new UsageError(NO_SERVER, false);
}

async function main(argv = process.argv.slice(2)) {
  const root = path.resolve(__dirname, "..", "..");
  try {
    const options = parseShotArgs(argv);
    if (options.help) {
      process.stdout.write(`${USAGE}\n`);
      return 0;
    }
    const playwright = path.join(root, "node_modules/@playwright/test/cli.js");
    if (!fs.existsSync(playwright))
      throw new UsageError(
        "Playwright is not installed. Run npm ci first.",
        false,
      );
    const base = await resolveBaseUrl({ flag: options.baseUrl, root });
    console.error(`shot: ${base.url} (${base.source})`);
    const { baseUrl: _flag, help: _help, ...request } = options;
    const result = spawnSync(
      process.execPath,
      [playwright, "test", "--config", "e2e/shot.playwright.config.ts"],
      {
        cwd: root,
        stdio: "inherit",
        env: {
          ...process.env,
          ELECTRIFY_SHOT: JSON.stringify({ ...request, baseURL: base.url }),
          FORCE_COLOR: "0",
        },
        windowsHide: true,
      },
    );
    if (result.error) throw result.error;
    return result.status ?? 1;
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`shot: ${error.message}`);
    if (error.usage) console.error('Run "npm run shot -- --help" for usage.');
    return 2;
  }
}

if (require.main === module)
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );

module.exports = {
  UsageError,
  VIEWS,
  THEMES,
  parseShotArgs,
  resolveBaseUrl,
  leasedPorts,
};
