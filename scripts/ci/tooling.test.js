const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const { createCoverageMap } = require("istanbul-lib-coverage");
const { parseShard, partition } = require("./jest-filter");
const {
  validateShards,
  normalizeCoverage,
  checkCoverage,
} = require("./coverage");
const { createServer } = require("./serve");

function temporary(t) {
  const parent = path.resolve(".tmp", "ci-tools");
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, "test-"));
  t.after(() => {
    assert(directory.startsWith(parent + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

test("shards discover new files, cover every suite exactly once, and agree regardless of discovery order", () => {
  const files = ["slow", "medium", "small", "new-test", "tiny"];
  const estimates = { slow: 100, medium: 50 };
  const groups = partition(files, 3, estimates);
  assert.deepEqual(groups, partition([...files].reverse(), 3, estimates));
  assert.deepEqual(groups.flat().sort(), [...files].sort());
  assert.equal(new Set(groups.flat()).size, files.length);
  assert.throws(() => partition(["same", "same"], 3), /duplicate/);
  for (const value of [undefined, "0/3", "4/3", "1/0", "1/65", "1.5/3"])
    assert.throws(() => parseShard(value), /TEST_SHARD/);
  assert.deepEqual(parseShard("2/3"), { index: 2, count: 3 });
});

test("the single-worker Jest filter selects every discovered unit and simulation suite", (t) => {
  const { spawnSync } = require("node:child_process");
  const directory = temporary(t);
  const all = [
    "src/new.test.tsx",
    "src/slow.test.tsx",
    "src/game.sim.test.tsx",
  ];
  for (const group of ["unit", "simulation"]) {
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `
      const filter = require(${JSON.stringify(require.resolve("./jest-filter"))});
      filter(${JSON.stringify(all)}.map(file => require('node:path').resolve(file)))
        .then(result => process.stdout.write(JSON.stringify(result)));
    `,
      ],
      {
        cwd: directory,
        encoding: "utf8",
        env: { ...process.env, TEST_SHARD: "1/1", TEST_GROUP: group },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const selected = JSON.parse(result.stdout).filtered.map(({ test: file }) =>
      path.relative(directory, file).split(path.sep).join("/"),
    );
    assert.deepEqual(selected.sort(), [...all].sort());
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(
          directory,
          "test-results",
          `jest-${group}-1`,
          "manifest.json",
        ),
        "utf8",
      ),
    );
    assert.deepEqual(manifest.selected, [...all].sort());
    assert.equal(manifest.count, 1);
  }
});

test("the coverage gate rejects missing, overlapping, stale and mislabeled shard assignments", () => {
  const all = ["a", "b", "c"];
  const manifests = all.map((file, index) => ({
    group: "unit",
    index: index + 1,
    count: 3,
    all,
    selected: [file],
  }));
  assert.equal(validateShards(manifests, 3), 3);
  assert.throws(() => validateShards(manifests.slice(1), 3), /Expected 3/);
  assert.throws(
    () => validateShards([manifests[0], manifests[0], manifests[2]], 3),
    /disagree/,
  );
  assert.throws(
    () =>
      validateShards(
        [manifests[0], { ...manifests[1], selected: ["a"] }, manifests[2]],
        3,
      ),
    /multiple shards/,
  );
  assert.throws(
    () =>
      validateShards(
        [manifests[0], { ...manifests[1], selected: [] }, manifests[2]],
        3,
      ),
    /every discovered/,
  );
  assert.throws(
    () =>
      validateShards(
        [manifests[0], { ...manifests[1], all: ["different"] }, manifests[2]],
        3,
      ),
    /disagree/,
  );
});

function coverage(file, hits) {
  return {
    [file]: {
      path: file,
      statementMap: {
        0: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
        1: { start: { line: 2, column: 0 }, end: { line: 2, column: 1 } },
      },
      s: { 0: hits[0], 1: hits[1] },
      fnMap: {},
      f: {},
      branchMap: {},
      b: {},
    },
  };
}

test("merged coverage uses Jest's original floors and rejects low or missing coverage", async (t) => {
  const directory = temporary(t);
  const root = process.cwd();
  const file = path.join(root, "src/helpers/ci-fixture.ts");
  const map = createCoverageMap(coverage(file, [1, 0]));
  const thresholds = { [file]: { statements: 85, lines: 85 } };
  await assert.rejects(
    checkCoverage(map.toJSON(), root, directory, thresholds),
    /threshold/,
  );
  map.merge(coverage(file, [0, 1]));
  await checkCoverage(map.toJSON(), root, directory, thresholds);
  assert.equal(map.fileCoverageFor(file).toSummary().statements.pct, 100);
  await assert.rejects(
    checkCoverage({}, root, directory, thresholds),
    /was not found/,
  );
});

test("coverage from a different checkout rebases to the current source tree without dropping untested files", () => {
  const raw = {
    ...coverage("/home/runner/other/src/helpers/a.ts", [1, 0]),
    ...coverage("C:\\work\\other\\src\\reducers\\untested.ts", [0, 0]),
  };
  const normalized = normalizeCoverage(raw, process.cwd());
  assert.equal(Object.keys(normalized).length, 2);
  assert.deepEqual(normalized[path.resolve("src/reducers/untested.ts")].s, {
    0: 0,
    1: 0,
  });
  assert.throws(() => normalizeCoverage({}, process.cwd()), /Empty/);
  assert.throws(
    () =>
      normalizeCoverage(coverage("/elsewhere/file.ts", [1, 1]), process.cwd()),
    /outside src/,
  );
});

test("production server delivers the actual built bytes and reports missing chunks as 404", async (t) => {
  const directory = temporary(t);
  fs.writeFileSync(
    path.join(directory, "index.html"),
    "<h1>production fixture</h1>",
  );
  fs.writeFileSync(
    path.join(directory, "worker.js"),
    "self.onmessage = () => {};",
  );
  const server = createServer(directory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await (await fetch(url)).text(), "<h1>production fixture</h1>");
  const script = await fetch(`${url}/worker.js`);
  assert.match(script.headers.get("content-type"), /javascript/);
  assert.equal(await script.text(), "self.onmessage = () => {};");
  assert.equal((await fetch(`${url}/missing.chunk.js`)).status, 404);
  assert.equal((await fetch(`${url}/..%2foutside`)).status, 403);
});
