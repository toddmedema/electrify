// Electron launches real native windows even when Playwright's headless setting is true.
// Require an explicit opt-in before any desktop test worker can start the application.
module.exports = function requireHeadedDesktop(config) {
  if (config.projects.every((project) => project.use.headless === false))
    return;

  throw new Error(
    "Electron tests open native windows and take keyboard focus. " +
      "Run local UI checks in headless Chromium with npm run test:e2e. " +
      "To deliberately run the native desktop suite, use npm run test:desktop -- --headed. " +
      "This requirement also applies in CI.",
  );
};
