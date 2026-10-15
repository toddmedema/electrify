const fs = require("node:fs");
const path = require("node:path");
const durations = require("./test-durations.json");

function parseShard(value) {
  const match = /^(\d+)\/(\d+)$/.exec(value || "");
  if (!match) throw new Error("TEST_SHARD must be an index/count, e.g. 1/3");
  const [, index, count] = match.map(Number);
  if (index < 1 || index > count || count > 64)
    throw new Error("TEST_SHARD must satisfy 1 <= index <= count <= 64");
  return { index, count };
}

const portable = (file) => file.split(path.sep).join("/");
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Every runner uses the same checked-in estimates. Using each shard's private Jest cache here
// would give different assignments on different machines and could silently omit tests.
function partition(
  files,
  count,
  estimates = durations,
  capacities = Array(count).fill(1),
) {
  if (new Set(files).size !== files.length)
    throw new Error("Jest discovered a duplicate test path");
  if (
    capacities.length !== count ||
    capacities.some((value) => !Number.isFinite(value) || value <= 0)
  )
    throw new Error(
      "Shard capacities must contain one positive number per shard",
    );
  const groups = capacities.map((capacity) => ({
    files: [],
    cost: 0,
    capacity,
  }));
  const cost = (file) => estimates[file] || 1;
  const ordered = [...files].sort((a, b) => cost(b) - cost(a) || compare(a, b));
  for (const file of ordered) {
    const group = groups.reduce((best, next) =>
      (next.cost + cost(file)) / next.capacity <
      (best.cost + cost(file)) / best.capacity
        ? next
        : best,
    );
    group.files.push(file);
    group.cost += cost(file);
  }
  return groups.map((group) => group.files.sort(compare));
}

async function filter(testPaths) {
  const { index, count } = parseShard(process.env.TEST_SHARD);
  const group = process.env.TEST_GROUP;
  if (!["unit", "simulation"].includes(group))
    throw new Error("TEST_GROUP must be unit or simulation");
  const root = process.cwd();
  const all = testPaths
    .map((file) => portable(path.relative(root, file)))
    .sort(compare);
  const capacities = process.env.TEST_SHARD_CAPACITIES?.split(",").map(Number);
  const selected = partition(all, count, durations, capacities)[index - 1];
  if (!selected.length)
    throw new Error(`Empty ${group} shard ${index}/${count}`);
  const directory = path.join("test-results", `jest-${group}-${index}`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "manifest.json"),
    JSON.stringify({ group, index, count, all, selected }, null, 2) + "\n",
  );
  console.error(
    `${group} shard ${index}/${count}: ${selected.length}/${all.length} suites`,
  );
  return {
    filtered: selected.map((file) => ({ test: path.resolve(root, file) })),
  };
}

module.exports = filter;
module.exports.parseShard = parseShard;
module.exports.partition = partition;
