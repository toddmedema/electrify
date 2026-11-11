const fs = require("node:fs");
const path = require("node:path");

// Reviewed official HTTPS archive mirrors, in deterministic preference order.
// https://launchpad.net/ubuntu/+mirror/mirror.csclub.uwaterloo.ca-archive
// https://launchpad.net/ubuntu/+mirror/mirror.clarkson.edu-archive
const mirrors = [
  "https://archive.ubuntu.com/ubuntu/",
  "https://mirror.csclub.uwaterloo.ca/ubuntu/",
  "https://mirror.clarkson.edu/ubuntu/",
];
const ubuntuUris = new Set(
  [
    "mirror+file:/etc/apt/apt-mirrors.txt",
    "http://azure.archive.ubuntu.com/ubuntu",
    "https://azure.archive.ubuntu.com/ubuntu",
    "http://archive.ubuntu.com/ubuntu",
    "http://security.ubuntu.com/ubuntu",
    "https://security.ubuntu.com/ubuntu",
    ...mirrors,
  ].map((uri) => uri.replace(/\/$/, "")),
);
const isUbuntuUri = (uri) => ubuntuUris.has(uri.replace(/\/$/, ""));

function sourceSuites(contents) {
  const suites = [];
  for (const line of contents.split("\n")) {
    const entry = line.match(
      /^\s*deb(?:-src)?\s+(?:\[[^\]]*\]\s+)?(\S+)\s+(\S+)/,
    );
    if (entry && isUbuntuUri(entry[1])) suites.push(entry[2]);
  }
  for (const stanza of contents.split(/\n\s*\n/)) {
    const uris = stanza.match(/^URIs:\s*(.+)$/m);
    const entry = stanza.match(/^Suites:\s*(.+)$/m);
    if (uris?.[1].split(/\s+/).some(isUbuntuUri) && entry)
      suites.push(...entry[1].split(/\s+/));
  }
  return suites;
}

async function selectMirror(
  suites,
  { request = fetch, timeoutMs = 10000 } = {},
) {
  const failures = [];
  for (const mirror of mirrors) {
    try {
      // Each mirror gets at most ten seconds, including DNS and response bodies.
      const signal = AbortSignal.timeout(timeoutMs);
      await Promise.all(
        suites.map(async (suite) => {
          const response = await request(`${mirror}dists/${suite}/InRelease`, {
            signal,
            redirect: "error",
          });
          if (!response.ok)
            throw new Error(`${suite}: HTTP ${response.status}`);
          const metadata = (await response.text()).replace(/\r\n/g, "\n");
          if (
            !metadata.startsWith("-----BEGIN PGP SIGNED MESSAGE-----\n") ||
            !metadata.includes("\nOrigin: Ubuntu\n") ||
            !metadata.includes(`\nSuite: ${suite}\n`) ||
            !metadata.includes("\n-----END PGP SIGNATURE-----")
          )
            throw new Error(`${suite}: unexpected Ubuntu release metadata`);
        }),
      );
      return mirror;
    } catch (error) {
      failures.push(`${mirror}: ${error.cause?.code || error.message}`);
    }
  }
  throw new Error(`No reachable Ubuntu apt mirror:\n${failures.join("\n")}`);
}

async function configureUbuntuApt(directory = "/etc/apt", options) {
  const parts = path.join(directory, "sources.list.d");
  const sources = [
    path.join(directory, "sources.list"),
    ...fs
      .readdirSync(parts)
      .filter((name) => /\.(list|sources)$/.test(name))
      .map((name) => path.join(parts, name)),
  ].filter((file) => fs.existsSync(file));
  const entries = sources.map((file) => ({
    file,
    original: fs.readFileSync(file, "utf8"),
  }));
  const suites = [
    ...new Set(entries.flatMap(({ original }) => sourceSuites(original))),
  ];
  if (!suites.length)
    throw new Error(
      "No supported Ubuntu apt source found; inspect the runner image",
    );
  // Probe every configured pocket before changing sources. Apt subsequently verifies
  // Ubuntu signatures using the existing signing keys; probes never replace that check.
  const mirror = await selectMirror(suites, options);
  for (const { file, original } of entries) {
    const contents = original.replace(/(^|\s)(\S+)/g, (entry, space, uri) =>
      isUbuntuUri(uri) ? space + mirror : entry,
    );
    if (contents !== original) fs.writeFileSync(file, contents);
  }
  // Playwright invokes apt itself, so configure the root-owned apt defaults once.
  // Error-Mode rejects stale indexes even when apt-get update would only warn.
  fs.writeFileSync(
    path.join(directory, "apt.conf.d", "99electrify-ci"),
    'Acquire::Retries "3";\n' +
      'Acquire::http::Timeout "30";\n' +
      'Acquire::https::Timeout "30";\n' +
      'APT::Update::Error-Mode "any";\n',
  );
  return mirror;
}

if (require.main === module)
  configureUbuntuApt().then(
    (mirror) => process.stdout.write(`Using Ubuntu apt mirror: ${mirror}\n`),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );

module.exports = { configureUbuntuApt, selectMirror };
