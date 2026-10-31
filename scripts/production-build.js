// Keep CRA's production compiler and compatibility settings; allow its compressor
// a second pass so the same renderer fits the existing shipped-JavaScript budget.
const path = require("node:path");
const configPath = require.resolve("react-scripts/config/webpack.config");
const TerserPlugin = require(
  require.resolve("terser-webpack-plugin", {
    paths: [path.dirname(configPath)],
  }),
);

function productionCompression(
  config,
  profile = process.argv.includes("--profile"),
) {
  const minimizers = config.optimization.minimizer;
  if (!minimizers.some((plugin) => plugin instanceof TerserPlugin))
    throw new Error("CRA's production Terser plugin was not found");
  return {
    ...config,
    optimization: {
      ...config.optimization,
      minimizer: minimizers.map((plugin) =>
        plugin instanceof TerserPlugin
          ? new TerserPlugin({
              // These are CRA's constructor options, guarded against the actual
              // installed configuration in production-compression.test.js.
              terserOptions: {
                parse: { ecma: 8 },
                compress: {
                  ecma: 5,
                  warnings: false,
                  comparisons: false,
                  inline: 2,
                  passes: 2,
                },
                mangle: { safari10: true },
                keep_classnames: profile,
                keep_fnames: profile,
                output: { ecma: 5, comments: false, ascii_only: true },
              },
            })
          : plugin,
      ),
    },
  };
}

if (require.main === module) {
  process.env.BABEL_ENV = "production";
  process.env.NODE_ENV = "production";
  require("react-scripts/config/env");
  const createConfig = require(configPath);
  require.cache[configPath].exports = (environment) =>
    productionCompression(createConfig(environment));
  require("react-scripts/scripts/build");
}

module.exports = { productionCompression };
