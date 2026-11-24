const path = require("node:path");
const { cpSync, mkdirSync } = require("node:fs");
const webpack = require("webpack");

const root = path.resolve(__dirname, "..");
const defaultOutput = path.join(root, "firebase/functions/build");

async function buildCheckpointValidator(output = defaultOutput) {
  require("./run-compatibility");
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: "production",
      context: root,
      target: "node24",
      entry: "./scripts/testing/coop-checkpoint-runtime.js",
      output: {
        path: path.join(output, "runtime/server"),
        filename: "checkpoint.cjs",
        library: { type: "commonjs2" },
      },
      devtool: false,
      optimization: { minimize: false },
      resolve: { extensions: [".tsx", ".ts", ".js", ".json"] },
      node: { __dirname: false },
      module: {
        rules: [
          {
            include: path.join(root, "src"),
            test: /\.[jt]sx?$/,
            use: {
              loader: require.resolve("babel-loader"),
              options: {
                babelrc: false,
                configFile: false,
                presets: [
                  [
                    require.resolve("@babel/preset-react"),
                    { runtime: "automatic" },
                  ],
                  require.resolve("@babel/preset-typescript"),
                ],
              },
            },
          },
        ],
      },
      plugins: [
        new webpack.DefinePlugin({
          "process.env.REACT_APP_DESKTOP": JSON.stringify("true"),
        }),
        new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
      ],
    });
    compiler.run((error, stats) => {
      compiler.close((closeError) => {
        if (error || closeError) reject(error ?? closeError);
        else if (stats.hasErrors() || stats.hasWarnings())
          reject(
            new Error(
              stats.toString({ all: false, errors: true, warnings: true }),
            ),
          );
        else resolve();
      });
    });
  });
  mkdirSync(path.join(output, "public"), { recursive: true });
  cpSync(path.join(root, "public/data"), path.join(output, "public/data"), {
    recursive: true,
  });
}

if (require.main === module)
  buildCheckpointValidator().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

module.exports = { buildCheckpointValidator };
