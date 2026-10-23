const fs = require("node:fs");
const path = require("node:path");
const { createModRecipes } = require("../src/mods/ModRecipes");
const {
  OBJECTIVE_DEFINITIONS,
} = require("../src/helpers/ScenarioObjectiveDefinitions");
async function main() {
  const directory = path.resolve(__dirname, "..", "docs", "mods", "recipes");
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, pack] of Object.entries(createModRecipes())) {
    const text = await require("prettier").format(JSON.stringify(pack), {
      parser: "json",
      ...require("../package.json").prettier,
    });
    const target = path.join(directory, `${name}.json`);
    if (process.argv.includes("--check")) {
      if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== text)
        throw new Error(`Recipe ${name} is stale. Run npm run mods:recipes.`);
    } else fs.writeFileSync(target, text);
  }
  const definitions =
    "# Objective definitions\n\nGenerated from the evaluator's shared metric definitions.\n\n| Metric | Definition |\n| --- | --- |\n" +
    Object.entries(OBJECTIVE_DEFINITIONS)
      .map(([metric, sentence]) => `| \`${metric}\` | ${sentence} |`)
      .join("\n") +
    "\n";
  const target = path.join(directory, "..", "objective-definitions.md");
  const text = await require("prettier").format(definitions, {
    parser: "markdown",
    ...require("../package.json").prettier,
  });
  if (process.argv.includes("--check")) {
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== text)
      throw new Error(
        "Objective definitions are stale. Run npm run mods:recipes.",
      );
  } else fs.writeFileSync(target, text);
}
main().catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
