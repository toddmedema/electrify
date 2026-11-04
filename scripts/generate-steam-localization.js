const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { presenceTokens } = require("../electron/steam-text.cjs");

function literalNumber(node, module, resolve, visiting = new Set()) {
  ({ node, module, visiting } = resolve(node, module, visiting));
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AsteriskToken
  )
    return (
      literalNumber(node.left, module, resolve, visiting) *
      literalNumber(node.right, module, resolve, visiting)
    );
  throw new Error(
    "Steam scenario metadata requires numeric literals or their products",
  );
}

/** Read only metadata initializer syntax; module bodies and unrelated fields never execute. */
function readScenarioMetadata(source, readModule) {
  const modules = new Map();
  const load = (name, source) => {
    if (modules.has(name)) return modules.get(name);
    const file = ts.createSourceFile(
      name,
      source ?? readModule?.(name),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const declarations = new Map();
    const imports = new Map();
    for (const statement of file.statements) {
      if (ts.isVariableStatement(statement)) {
        for (const entry of statement.declarationList.declarations) {
          if (!ts.isIdentifier(entry.name)) continue;
          declarations.set(entry.name.text, {
            node: entry.initializer,
            constant: !!(statement.declarationList.flags & ts.NodeFlags.Const),
            exported: !!statement.modifiers?.some(
              (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
            ),
          });
        }
      } else if (
        ts.isImportDeclaration(statement) &&
        !statement.importClause?.isTypeOnly &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings)
      ) {
        for (const entry of statement.importClause.namedBindings.elements) {
          if (!entry.isTypeOnly)
            imports.set(entry.name.text, {
              module: statement.moduleSpecifier.text,
              name: (entry.propertyName ?? entry.name).text,
            });
        }
      }
    }
    const module = { name, declarations, imports };
    modules.set(name, module);
    return module;
  };
  const root = load("Scenarios.tsx", source);
  const resolve = (node, module, visiting = new Set()) => {
    if (ts.isParenthesizedExpression(node))
      return resolve(node.expression, module, visiting);
    if (!ts.isIdentifier(node)) return { node, module, visiting };
    const key = `${module.name}:${node.text}`;
    if (visiting.has(key)) throw new Error("Cyclic Steam scenario metadata");
    visiting = new Set([...visiting, key]);
    const declaration = module.declarations.get(node.text);
    if (declaration) {
      if (!declaration.constant || !declaration.node)
        throw new Error("Steam scenario metadata references must be constants");
      return resolve(declaration.node, module, visiting);
    }
    const imported = module.imports.get(node.text);
    if (
      !imported ||
      !readModule ||
      !/^\.\/[A-Za-z][A-Za-z0-9_-]*$/.test(imported.module)
    )
      throw new Error(
        "Steam scenario metadata requires trusted local constants",
      );
    const target = load(imported.module);
    if (!target.declarations.get(imported.name)?.exported)
      throw new Error(
        "Steam scenario metadata imports must be exported constants",
      );
    return resolve(
      ts.factory.createIdentifier(imported.name),
      target,
      visiting,
    );
  };
  const declaration = root.declarations.get("SCENARIOS");
  if (!declaration?.node || !ts.isArrayLiteralExpression(declaration.node))
    throw new Error("Expected the authored top-level SCENARIOS array");
  const scenarios = {};
  for (const candidate of declaration.node.elements) {
    const { node: entry, module } = resolve(candidate, root);
    const resolveField = (node) => resolve(node, module).node;
    if (!ts.isObjectLiteralExpression(entry))
      throw new Error("Scenario metadata must be authored object literals");
    const fields = Object.fromEntries(
      entry.properties
        .filter(ts.isPropertyAssignment)
        .filter(
          (field) =>
            ts.isIdentifier(field.name) || ts.isStringLiteral(field.name),
        )
        .map((field) => [field.name.text, field.initializer]),
    );
    if (
      !fields.id ||
      !fields.name ||
      !fields.durationMonths ||
      !ts.isStringLiteral(resolveField(fields.name))
    )
      throw new Error(
        "Every authored scenario requires an ID, literal name and duration",
      );
    const id = literalNumber(fields.id, module, resolve);
    const months = literalNumber(fields.durationMonths, module, resolve);
    const name = resolveField(fields.name).text;
    if (
      !Number.isSafeInteger(id) ||
      id < 0 ||
      scenarios[id] ||
      !Number.isSafeInteger(months) ||
      months <= 0 ||
      !name ||
      Buffer.byteLength(name) > 100 ||
      /[\0\r\n{}%]/.test(name)
    )
      throw new Error("Invalid authored Steam scenario metadata");
    scenarios[id] = { name, durationMonths: months };
  }
  return scenarios;
}

function renderMetadata(scenarios) {
  return `// Generated from the authored SCENARIOS array; run node scripts/generate-steam-localization.js.\nmodule.exports = ${JSON.stringify(scenarios, null, 2)};\n`;
}

function renderLocalization(scenarios) {
  const quote = (value) => JSON.stringify(value);
  return `"lang"\n{\n  "english"\n  {\n    "tokens"\n    {\n${Object.entries(
    presenceTokens(scenarios),
  )
    .map(([key, value]) => `      ${quote(key)} ${quote(value)}`)
    .join("\n")}\n    }\n  }\n}\n`;
}

function readAuthoredScenarioMetadata(root = path.resolve(__dirname, "..")) {
  const directory = path.join(root, "src/data");
  return readScenarioMetadata(
    fs.readFileSync(path.join(directory, "Scenarios.tsx"), "utf8"),
    (specifier) => {
      // readScenarioMetadata accepts only a single local basename, never traversal or packages.
      const filename = [".ts", ".tsx"]
        .map((extension) => path.join(directory, specifier + extension))
        .find((candidate) => fs.existsSync(candidate));
      if (!filename)
        throw new Error(`Missing authored scenario module: ${specifier}`);
      return fs.readFileSync(filename, "utf8");
    },
  );
}

async function generateSteamLocalization(root = path.resolve(__dirname, "..")) {
  const scenarios = readAuthoredScenarioMetadata(root);
  const metadataPath = path.join(root, "electron/steam-localization.cjs");
  const prettier = require("prettier");
  fs.writeFileSync(
    metadataPath,
    await prettier.format(renderMetadata(scenarios), {
      ...(await prettier.resolveConfig(metadataPath)),
      filepath: metadataPath,
    }),
  );
  fs.mkdirSync(path.join(root, "steamworks"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "steamworks/rich-presence.vdf"),
    renderLocalization(scenarios),
  );
  return scenarios;
}

if (require.main === module)
  generateSteamLocalization().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = {
  readScenarioMetadata,
  readAuthoredScenarioMetadata,
  renderMetadata,
  renderLocalization,
  generateSteamLocalization,
};
