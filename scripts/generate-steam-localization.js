const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { presenceTokens } = require("../electron/steam-text.cjs");

function literalNumber(node) {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isParenthesizedExpression(node)) return literalNumber(node.expression);
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AsteriskToken
  )
    return literalNumber(node.left) * literalNumber(node.right);
  throw new Error(
    "Steam scenario metadata requires numeric literals or their products",
  );
}

function readScenarioMetadata(source) {
  const file = ts.createSourceFile(
    "Scenarios.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const declaration = file.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find(
      (entry) => ts.isIdentifier(entry.name) && entry.name.text === "SCENARIOS",
    );
  if (
    !declaration?.initializer ||
    !ts.isArrayLiteralExpression(declaration.initializer)
  )
    throw new Error("Expected the authored top-level SCENARIOS array");
  const scenarios = {};
  for (const entry of declaration.initializer.elements) {
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
      !ts.isStringLiteral(fields.name)
    )
      throw new Error(
        "Every authored scenario requires an ID, literal name and duration",
      );
    const id = literalNumber(fields.id);
    const months = literalNumber(fields.durationMonths);
    const name = fields.name.text;
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

async function generateSteamLocalization(root = path.resolve(__dirname, "..")) {
  const scenarios = readScenarioMetadata(
    fs.readFileSync(path.join(root, "src/data/Scenarios.tsx"), "utf8"),
  );
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
  renderMetadata,
  renderLocalization,
  generateSteamLocalization,
};
