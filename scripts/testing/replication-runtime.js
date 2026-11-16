// Standalone simulation tools use the installed TypeScript compiler, including trimmed desktop CI.
// Only repository source is transformed; dependencies retain their ordinary Node loaders.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const source = path.resolve(__dirname, "../../src") + path.sep;
const originalJs = require.extensions[".js"];
function compile(module, filename) {
  if (!filename.startsWith(source))
    throw new Error(
      "The replication runtime only transforms repository source",
    );
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
  });
  module._compile(outputText, filename);
}
module.exports = function installReplicationRuntime() {
  process.env.REACT_APP_DESKTOP = "true";
  require.extensions[".ts"] = compile;
  require.extensions[".tsx"] = compile;
  require.extensions[".js"] = (module, filename) =>
    filename.startsWith(source)
      ? compile(module, filename)
      : originalJs(module, filename);
};
