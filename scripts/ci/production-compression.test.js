const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

process.env.NODE_ENV = "production";
process.env.BABEL_ENV = "production";
require("react-scripts/config/env");
const createConfig = require("react-scripts/config/webpack.config");
const { productionCompression } = require("../production-build");

for (const profile of [false, true]) {
  test(`production compression preserves CRA options with profiling=${profile}`, async () => {
    const originalArgv = process.argv;
    try {
      process.argv = originalArgv.filter(
        (argument) => argument !== "--profile",
      );
      if (profile) process.argv.push("--profile");
      const original = createConfig("production");
      const optimized = productionCompression(original);
      const [before, ...otherMinimizers] = original.optimization.minimizer;
      const [after, ...remainingMinimizers] = optimized.optimization.minimizer;
      assert.deepEqual(after.options, {
        ...before.options,
        minimizer: {
          ...before.options.minimizer,
          options: {
            ...before.options.minimizer.options,
            compress: {
              ...before.options.minimizer.options.compress,
              passes: 2,
            },
          },
        },
      });
      assert.equal(before.options.minimizer.options.compress.passes, undefined);
      assert.equal(after.options.minimizer.options.keep_classnames, profile);
      assert.equal(after.options.minimizer.options.keep_fnames, profile);
      assert.deepEqual(remainingMinimizers, otherMinimizers);
      assert.deepEqual(
        {
          ...optimized.optimization,
          minimizer: original.optimization.minimizer,
        },
        original.optimization,
      );
      assert.deepEqual(
        { ...optimized, optimization: original.optimization },
        original,
      );

      // Exercise the installed plugin, including negative zero, finite/infinite
      // numbers, undefined own properties, closures, strings and thrown errors.
      const source = `
        globalThis.result = (() => {
          function quote(principal, rate) { return () => principal * rate / 12; }
          const data = { reason: undefined, text: "Québec × 2", zero: -0 };
          let error;
          try { throw new Error("preserved"); } catch (caught) { error = caught.message; }
          return [quote(410000000, .05)(), Object.is(data.zero, -0),
            Object.hasOwn(data, "reason"), data.text, error,
            [Infinity, NaN, undefined].map(value => String(value))];
        })();
      `;
      const result = await after.constructor.terserMinify(
        { "fixture.js": source },
        undefined,
        after.options.minimizer.options,
      );
      assert.deepEqual(result.errors, undefined);
      assert.equal(
        vm.runInNewContext(result.code + "; JSON.stringify(globalThis.result)"),
        vm.runInNewContext(source + "; JSON.stringify(globalThis.result)"),
      );
    } finally {
      process.argv = originalArgv;
    }
  });
}
