const fs = require("node:fs");
const path = require("node:path");
const { createModEditorSchema } = require("../src/mods/ModEditorSchema");
const target = path.resolve(
  __dirname,
  "..",
  "docs",
  "mods",
  "scenario.schema.json",
);
async function main() {
  const content = await require("prettier").format(
    JSON.stringify(createModEditorSchema()),
    { parser: "json", ...require("../package.json").prettier },
  );
  if (process.argv.includes("--check")) {
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content) {
      process.stderr.write(
        "Editor schema is stale. Run npm run mods:schema.\n",
      );
      process.exitCode = 1;
    }
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}
main().catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
