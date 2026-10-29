const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const ts = require("typescript");
const { builtinModules } = require("node:module");

const generated = [
  "src/data/RunCompatibility.json",
  "public/icons.json",
  "node_modules/.package-lock.json",
];
const renderer = new Set([
  "build",
  "bundle",
  "browser",
  "desktop-build",
  "multiplayer",
  "steam-input",
]);
const ordinaryTestExempt = new Set([
  ...renderer,
  "sim",
  "simulations",
  "bench",
]);
const simulationTestExempt = new Set([...renderer, "tests", "sim", "bench"]);
const browserExempt = new Set([
  "build",
  "desktop-build",
  "sim",
  "simulations",
  "bench",
  "tests",
]);
const operationalEnv = new Set([
  "PWD",
  "OLDPWD",
  "INIT_CWD",
  "SHLVL",
  "_",
  "E2E_PORT",
  "PORT",
  "ELECTRIFY_DEVELOPMENT_LEASE",
  "ELECTRIFY_DEVELOPMENT_GROUP",
  "ELECTRIFY_COORDINATION_WAIT_MS",
  "ELECTRIFY_E2E_OUTPUT_DIR",
  "ELECTRIFY_TASK_ID",
  "CODEX_THREAD_ID",
  "CODEX_TOOL_CALL_ID",
]);
// These reviewed loaders target installed packages or a test VM dependency map,
// never excluded src/e2e tests. Pin the complete file, not only the require call:
// changing its target calculation must revoke the exception and hash all inputs.
const auditedLoaders = {
  // The VM receives electron/main.cjs and a fixed dependency map.
  "electron/main.test.cjs":
    "45853089d8c7dd3cc9fd22ec54db57e2bcb729c3c21226e7c5d0212516f6da5f",
  // nativeBindingPath resolves only the platform's installed steamworks binary.
  "electron/steam-native.cjs":
    "5dbd747ecb6eb2c6f56c8b91254abea6ac83328e40d863bc8a99ed1cbf754702",
  "electron/steam-native.test.cjs":
    "fda8913723f0e6d3bbde2858d0b808018b0396ce024e17c8527a461f09cc71de",
  // devServerConfigPath comes from the literal CRA package require.resolve.
  "scripts/start.js":
    "b71762b40a2b08d20b21eb885fc0b71bbd7f35ec752dba53016699e3e1be62bd",
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

function digest(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function fileDigest(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile())
    throw new Error(`Cache input is not a regular file: ${file}`);
  return createHash("sha256")
    .update(String(stat.mode & 0o111))
    .update("\0")
    .update(fs.readFileSync(file))
    .digest("hex");
}

/** Git supplies membership, never commit identity: staging/committing identical
 * bytes must not invalidate useful evidence. Known ignored runtime inputs join it. */
function sourceInputs(root = process.cwd()) {
  const files = new Set(
    execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
      .split("\0")
      .filter(Boolean),
  );
  for (const name of generated) files.add(name);
  for (const name of [
    ".env",
    ".env.local",
    ".env.production",
    ".env.production.local",
    ".env.development",
    ".env.development.local",
    ".env.test",
    ".env.test.local",
  ])
    files.add(name);
  for (const name of fs.readdirSync(root))
    if (/^\.env(?:\.|$)/.test(name)) files.add(name);
  return [...files].sort().map((name) => {
    let hash;
    try {
      hash = fileDigest(path.join(root, name));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      hash = "missing";
    }
    return { path: name.replace(/\\/g, "/"), digest: hash };
  });
}

function exempt(file, id) {
  if (file.startsWith("e2e/")) return browserExempt.has(id);
  if (!file.startsWith("src/")) return false;
  if (/\.sim\.test\.[jt]sx?(?:\.snap)?$/.test(file))
    return simulationTestExempt.has(id);
  if (/\.(?:test|spec)\.[jt]sx?(?:\.snap)?$/.test(file))
    return ordinaryTestExempt.has(id);
  return false;
}

const graphs = new Map();
function references(root, inputs) {
  const code = inputs.filter(
    (entry) => /\.[cm]?[jt]sx?$/.test(entry.path) && entry.digest !== "missing",
  );
  const key = digest([path.resolve(root), inputs]);
  if (graphs.has(key)) return graphs.get(key);
  const names = new Set(inputs.map((entry) => entry.path));
  let options = {
    moduleResolution: ts.ModuleResolutionKind.Node10,
    allowJs: true,
    resolveJsonModule: true,
  };
  const config = path.join(root, "tsconfig.json");
  if (fs.existsSync(config)) {
    const parsed = ts.readConfigFile(config, ts.sys.readFile);
    if (parsed.error)
      throw new Error(
        "Cannot resolve cache input imports: invalid tsconfig.json",
      );
    options = {
      ...options,
      ...ts.parseJsonConfigFileContent(parsed.config, ts.sys, root).options,
    };
  }
  const graph = new Map();
  for (const { path: file } of code) {
    const contents = fs.readFileSync(path.join(root, file), "utf8");
    const audited =
      auditedLoaders[file] ===
      createHash("sha256").update(contents).digest("hex");
    const source = ts.createSourceFile(
      file,
      contents,
      ts.ScriptTarget.Latest,
      true,
    );
    const links = new Set();
    let uncertain = false;
    let unsupported = false;
    const resolve = (specifier) => {
      if (specifier.startsWith(".")) {
        const direct = path.posix.normalize(
          path.posix.join(path.posix.dirname(file), specifier),
        );
        if (names.has(direct)) {
          links.add(direct);
          return;
        }
      }
      const result = ts.resolveModuleName(
        specifier,
        path.join(root, file),
        options,
        ts.sys,
      ).resolvedModule;
      let resolved = result?.resolvedFileName;
      if (!resolved) {
        // TypeScript does not resolve package assets such as uPlot's CSS.
        // Node can resolve those without treating an unknown alias as external.
        try {
          resolved = require.resolve(specifier, {
            paths: [path.dirname(path.join(root, file))],
          });
        } catch {
          // An unresolved import retains every known source input.
        }
      }
      if (resolved && !resolved.split(path.sep).includes("node_modules")) {
        const relative = path.relative(root, resolved).replace(/\\/g, "/");
        if (names.has(relative)) links.add(relative);
        else if (path.isAbsolute(resolved)) unsupported = true;
      } else if (
        !resolved &&
        !specifier.startsWith("node:") &&
        !builtinModules.includes(specifier)
      )
        uncertain = true;
    };
    function visit(node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      )
        resolve(node.moduleSpecifier.text);
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)
      )
        resolve(node.argument.literal.text);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require") ||
          (ts.isPropertyAccessExpression(node.expression) &&
            ts.isIdentifier(node.expression.expression) &&
            node.expression.expression.text === "require" &&
            node.expression.name.text === "resolve"))
      ) {
        if (node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]))
          resolve(node.arguments[0].text);
        else {
          // The analyzer resolves names to inspect dependencies; it never loads
          // those modules. Other unknown dynamic require.resolve calls fail closed.
          const introspection =
            path.resolve(root, file) === __filename &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === "resolve";
          if (!audited && !introspection) uncertain = true;
        }
      }
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "URL" &&
        node.arguments?.[1]?.getText(source) === "import.meta.url"
      ) {
        if (ts.isStringLiteralLike(node.arguments[0]))
          resolve(node.arguments[0].text);
        else if (!audited) uncertain = true;
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    graph.set(file, { links, uncertain, unsupported });
  }
  // Keep both sides of a comparison without accumulating a graph per edit.
  if (graphs.size >= 2) graphs.delete(graphs.keys().next().value);
  graphs.set(key, graph);
  return graph;
}

function gateInputs(step, root, inputs) {
  const selected = new Set(
    inputs
      .filter(({ path: file }) => !exempt(file, step.id))
      .map(({ path: file }) => file),
  );
  const graph = references(root, inputs);
  // An ignored local module has no content entry to hash. Decline reuse instead
  // of claiming that hashing the remaining sources covers that dependency.
  if ([...graph.values()].some((reference) => reference.unsupported))
    return null;
  const pending = [...selected];
  for (let index = 0; index < pending.length; index++) {
    const reference = graph.get(pending[index]);
    // Computed imports or unresolved local references cannot justify
    // excluding a test/helper. Hash everything until the dependency is explicit.
    if (reference?.uncertain) return inputs;
    for (const target of reference?.links || [])
      if (!selected.has(target)) {
        selected.add(target);
        pending.push(target);
      }
  }
  return inputs.filter(({ path: file }) => selected.has(file));
}

function gateKey(
  step,
  {
    root = process.cwd(),
    inputs = sourceInputs(root),
    command,
    env = process.env,
    workers,
    artifactDigest,
  } = {},
) {
  const selectedInputs = gateInputs(step, root, inputs);
  if (!selectedInputs) return null;
  const environment = Object.fromEntries(
    Object.entries(env).filter(
      ([key]) => !operationalEnv.has(key) && !key.startsWith("npm_lifecycle_"),
    ),
  );
  // Only a digest leaves this function; environment values may contain secrets.
  return digest({
    version: 1,
    step,
    command,
    environment,
    workers,
    artifactDigest,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    inputs: selectedInputs,
  });
}

function digestDirectory(directory) {
  if (!fs.lstatSync(directory).isDirectory())
    throw new Error("Cached artifact must be a real directory");
  const entries = [];
  function walk(folder, prefix = "") {
    for (const name of fs.readdirSync(folder).sort()) {
      const file = path.join(folder, name),
        relative = prefix + name;
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) {
        entries.push([relative + "/", "directory"]);
        walk(file, relative + "/");
      } else entries.push([relative, fileDigest(file)]);
    }
  }
  walk(directory);
  return digest(entries);
}

function safeFile(directory, relative) {
  if (
    typeof relative !== "string" ||
    path.posix.isAbsolute(relative) ||
    path.win32.isAbsolute(relative)
  )
    throw new Error("Cache evidence path must be relative");
  const parts = relative.split(/[\\/]/);
  if (
    parts.some(
      (part) => !part || part === "." || part === ".." || part.includes(":"),
    )
  )
    throw new Error("Unsafe cache evidence path");
  let target = directory;
  for (const part of parts) {
    target = path.join(target, part);
    if (fs.lstatSync(target).isSymbolicLink())
      throw new Error("Symlinked cache evidence is not reusable");
  }
  return target;
}

function evidenceDigest(directory, gate) {
  if (!Array.isArray(gate.reports || []))
    throw new Error("Invalid retained report list");
  const names = [gate.log, ...(gate.reports || [])];
  if (new Set(names).size !== names.length)
    throw new Error("Duplicate cache evidence paths");
  return digest(
    names.map((relative, index) => {
      const file = safeFile(directory, relative);
      const hash = fileDigest(file);
      if (index > 0) JSON.parse(fs.readFileSync(file, "utf8"));
      return [relative.replace(/\\/g, "/"), hash];
    }),
  );
}

function findReusable(reportsDirectory, step, key, artifactDigest) {
  if (!key || (renderer.has(step.id) && !artifactDigest)) return null;
  let names;
  try {
    names = fs.readdirSync(reportsDirectory).sort().reverse();
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  for (const name of names) {
    try {
      const directory = path.join(reportsDirectory, name);
      if (!fs.lstatSync(directory).isDirectory()) continue;
      const reportPath = safeFile(directory, "report.json");
      const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
      if (
        report.schemaVersion !== 1 ||
        !["passed", "failed"].includes(report.status) ||
        !report.finishedAt ||
        report.source?.changedDuringRun !== false ||
        !report.source?.before?.fingerprint ||
        report.source.before.fingerprint !== report.source?.after?.fingerprint
      )
        continue;
      if (report.source.behaviorBefore !== report.source.behaviorAfter)
        continue;
      if (!Array.isArray(report.gates)) continue;
      const matches = report.gates.filter((gate) => gate.id === step.id);
      if (matches.length !== 1) continue;
      const gate = matches[0];
      if (
        gate.status !== "passed" ||
        gate.exitCode !== 0 ||
        gate.ok === false ||
        gate.reportErrors?.length ||
        gate.inputKey !== key ||
        gate.artifactDigest !== artifactDigest ||
        !gate.evidenceDigest
      )
        continue;
      const expected = (step.reports || []).map((file) => `${step.id}/${file}`);
      if (
        JSON.stringify(
          (gate.reports || []).map((file) => file.replace(/\\/g, "/")).sort(),
        ) !== JSON.stringify(expected.sort())
      )
        continue;
      if (gate.evidenceDigest !== evidenceDigest(directory, gate)) continue;
      return { gate, reportPath };
    } catch {
      // Missing, corrupt, partial, symlinked or old-format evidence is a cache miss.
    }
  }
  return null;
}

module.exports = {
  sourceInputs,
  gateKey,
  digestDirectory,
  evidenceDigest,
  findReusable,
};
