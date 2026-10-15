const fs = require("node:fs");
const path = require("node:path");

const tools = [
  "@playwright/test",
  "electron-builder",
  "prettier",
  "typescript",
];

function trimLock(lock, root) {
  const packages = { "": root };
  const pending = [""];
  function resolve(from, name) {
    for (let prefix = from; ;) {
      const key = `${prefix ? prefix + "/" : ""}node_modules/${name}`;
      if (lock.packages[key]) return key;
      if (!prefix) return undefined;
      const parent = prefix.lastIndexOf("/node_modules/");
      prefix = parent < 0 ? "" : prefix.slice(0, parent);
    }
  }
  while (pending.length) {
    const from = pending.pop();
    const entry = packages[from];
    const dependencies = {
      ...entry.dependencies,
      ...entry.optionalDependencies,
      ...entry.peerDependencies,
      ...(from === "" ? entry.devDependencies : {}),
    };
    for (const name of Object.keys(dependencies)) {
      const key = resolve(from, name);
      if (!key) {
        if (
          entry.optionalDependencies?.[name] ||
          entry.peerDependenciesMeta?.[name]?.optional
        )
          continue;
        throw new Error(
          `Missing locked dependency: ${from || "root"} -> ${name}`,
        );
      }
      if (!packages[key]) {
        // Keep the original resolution, version, integrity, native-platform restrictions
        // and nested location. No dependency is re-resolved from a version range.
        packages[key] = lock.packages[key];
        pending.push(key);
      }
    }
  }
  return { ...lock, packages };
}

function profileFiles(pkg, lock) {
  const devDependencies = Object.fromEntries(
    tools.map((name) => {
      if (!pkg.devDependencies[name])
        throw new Error(`Missing native QA tool: ${name}`);
      return [name, pkg.devDependencies[name]];
    }),
  );
  return {
    pkg: { ...pkg, devDependencies },
    lock: trimLock(lock, { ...lock.packages[""], devDependencies }),
  };
}

function main(mode) {
  const root = process.cwd();
  const directory = path.resolve(root, ".tmp", "desktop-deps");
  if (mode === "prepare") {
    const read = (name) =>
      JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
    const { pkg, lock } = profileFiles(
      read("package.json"),
      read("package-lock.json"),
    );
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify(pkg, null, 2) + "\n",
    );
    fs.writeFileSync(
      path.join(directory, "package-lock.json"),
      JSON.stringify(lock, null, 2) + "\n",
    );
    console.error(
      `Native QA install: ${Object.keys(lock.packages).length - 1} unchanged locked packages.`,
    );
  } else if (mode === "adopt") {
    const source = path.resolve(directory, "node_modules");
    const target = path.resolve(root, "node_modules");
    if (
      !source.startsWith(root + path.sep) ||
      !target.startsWith(root + path.sep) ||
      fs.existsSync(target)
    )
      throw new Error(
        "Refusing to replace an existing dependency tree or move outside the checkout",
      );
    fs.renameSync(source, target);
  } else throw new Error("Use prepare or adopt");
}

if (require.main === module) main(process.argv[2]);
module.exports = { trimLock, profileFiles };
