// CRA 5 still configures the middleware hooks and HTTPS option removed in
// webpack-dev-server 5. Keep CRA's start script, compiler messages and proxy handling while
// translating only those retired options to their current equivalents.
process.env.BABEL_ENV = "development";
process.env.NODE_ENV = "development";
require("react-scripts/config/env");

const devServerConfigPath =
  require.resolve("react-scripts/config/webpackDevServer.config");
const createDevServerConfig = require(devServerConfigPath);

function captureMiddlewares(callback, devServer) {
  if (!callback) {
    return [];
  }

  const captured = [];
  const app = devServer.app;
  const originalUse = app.use;
  app.use = (...args) => {
    const path = typeof args[0] === "function" ? undefined : args.shift();
    for (const middleware of args.flat()) {
      captured.push({
        name: "cra-compat-middleware",
        ...(path === undefined ? {} : { path }),
        middleware,
      });
    }
    return app;
  };

  try {
    callback(devServer);
  } finally {
    app.use = originalUse;
  }
  return captured;
}

function adaptDevServerConfig(config) {
  const { https, onAfterSetupMiddleware, onBeforeSetupMiddleware, ...adapted } =
    config;

  if (https) {
    adapted.server = { type: "https", options: https };
  }
  adapted.setupMiddlewares = (middlewares, devServer) => [
    ...captureMiddlewares(onBeforeSetupMiddleware, devServer),
    ...middlewares,
    ...captureMiddlewares(onAfterSetupMiddleware, devServer),
  ];
  // The e2e suite (ELECTRIFY_E2E=1, set by e2e/playwright.config.ts) must never be blocked by
  // the dev error overlay. A runtime error in the app -- or in a worker whose lazy code chunk
  // fails to load while the dev server is busy -- would otherwise cover every control with a
  // red overlay and fail every test that clicks the page. Compilation errors still show;
  // only the runtime-error overlay is suppressed for the suite.
  if (process.env.ELECTRIFY_E2E) {
    adapted.client = {
      ...adapted.client,
      overlay: { ...adapted.client?.overlay, runtimeErrors: false },
    };
  }
  return adapted;
}

require.cache[devServerConfigPath].exports = (...args) =>
  adaptDevServerConfig(createDevServerConfig(...args));

require("react-scripts/scripts/start");
