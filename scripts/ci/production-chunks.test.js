const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const webpack = require("webpack");

process.env.NODE_ENV = "production";
process.env.BABEL_ENV = "production";
require("react-scripts/config/env");
const createConfig = require("react-scripts/config/webpack.config");
const { productionCompression } = require("../production-build");

test(
  "the page and its worker share one emitted module and both execute",
  { timeout: 10000 },
  async () => {
    const directory = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "electrify-chunks-")),
    );
    const output = path.join(directory, "output");
    try {
      await Promise.all([
        fs.writeFile(
          path.join(directory, "shared.js"),
          "export function forecast(value) { return value * 3 + 7; }",
        ),
        fs.writeFile(
          path.join(directory, "page.js"),
          `import { forecast } from "./shared.js";
         globalThis.result = forecast(5);
         globalThis.worker = new Worker(new URL("./worker.js", import.meta.url));`,
        ),
        fs.writeFile(
          path.join(directory, "worker.js"),
          `import { forecast } from "./shared.js";
         postMessage(forecast(11));`,
        ),
      ]);
      const { optimization } = productionCompression(
        createConfig("production"),
      );
      const compiler = webpack({
        mode: "production",
        context: directory,
        entry: "./page.js",
        output: { path: output, filename: "[name].js", publicPath: "" },
        optimization: {
          ...optimization,
          concatenateModules: false,
          // A small fixture exercises the production chunk policy without the
          // size of the real simulation data needed to cross webpack's defaults.
          splitChunks: {
            ...optimization.splitChunks,
            minSize: 0,
            minRemainingSize: 0,
          },
        },
      });
      const stats = await new Promise((resolve, reject) =>
        compiler.run((error, result) => {
          compiler.close((closeError) => {
            if (error || closeError) reject(error || closeError);
            else resolve(result);
          });
        }),
      );
      assert.equal(stats.hasErrors(), false, stats.toString("errors-only"));
      const sharedModule = [...stats.compilation.modules].find(
        (module) => module.resource === path.join(directory, "shared.js"),
      );
      assert.ok(sharedModule, "the shared calculation was compiled");
      assert.equal(
        stats.compilation.chunkGraph.getNumberOfModuleChunks(sharedModule),
        1,
        "the shared calculation must be emitted once across page and worker",
      );

      const scripts = new Map(
        await Promise.all(
          (await fs.readdir(output)).map(async (file) => [
            file,
            await fs.readFile(path.join(output, file), "utf8"),
          ]),
        ),
      );
      const runScript = (url, context) => {
        const file = path.basename(String(url));
        assert.ok(scripts.has(file), `the emitted chunk ${file} exists`);
        vm.runInContext(scripts.get(file), context, { filename: file });
      };
      let resolveWorker;
      const workerResult = new Promise((resolve) => {
        resolveWorker = resolve;
      });
      const page = vm.createContext({
        URL,
        document: { baseURI: "https://electrify.test/" },
        Worker: class {
          constructor(url) {
            const worker = vm.createContext({
              URL,
              location: { href: String(url) },
              postMessage: resolveWorker,
            });
            worker.self = worker;
            worker.importScripts = (...urls) =>
              urls.forEach((chunk) => runScript(chunk, worker));
            runScript(url, worker);
          }
        },
      });
      page.self = page;
      for (const file of stats.compilation.entrypoints.get("main").getFiles())
        runScript(file, page);
      assert.equal(page.result, 22);
      assert.equal(await workerResult, 40);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
);
