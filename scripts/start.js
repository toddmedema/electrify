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
  // The e2e suite (ELECTRIFY_E2E=1, set by e2e/playwright.config.ts) must not be blocked by a
  // lazy code chunk that fails to fetch while the dev server is busy: the dev overlay would
  // cover every control and fail each later click in that test. Only chunk-load failures are
  // hidden; any other runtime error still shows the overlay, and compilation errors are
  // untouched. webpack-dev-server serializes this filter into the browser, so it must not close
  // over anything.
  if (process.env.ELECTRIFY_E2E === "1") {
    adapted.client = {
      ...adapted.client,
      overlay: {
        ...adapted.client?.overlay,
        runtimeErrors: (error) =>
          !/ChunkLoadError|Loading (CSS )?chunk|importScripts/.test(
            `${error.name}: ${error.message}`,
          ),
      },
    };
  }
  return adapted;
}

require.cache[devServerConfigPath].exports = (...args) =>
  adaptDevServerConfig(createDevServerConfig(...args));

require("react-scripts/scripts/start");
