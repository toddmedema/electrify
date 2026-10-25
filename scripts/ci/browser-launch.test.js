const { test } = require("node:test");
const assert = require("node:assert/strict");
const { browserLaunchOptions } = require("./browser-launch");

test("only Windows changes Chromium networking and keeps all existing disabled features", () => {
  for (const platform of ["darwin", "linux"]) {
    assert.deepEqual(browserLaunchOptions(platform), {});
  }
  const { server } = require("playwright-core/lib/coreBundle");
  const chromium = server.createPlaywright({
    sdkLanguage: "javascript",
  }).chromium;
  const defaults = chromium._innerDefaultArgs({});
  const options = browserLaunchOptions("win32");
  const effective = chromium
    ._innerDefaultArgs(options)
    .filter((arg) => !options.ignoreDefaultArgs.includes(arg));
  const featureSwitches = effective.filter((arg) =>
    arg.startsWith("--disable-features="),
  );
  assert.equal(featureSwitches.length, 1);
  const original = defaults.find((arg) =>
    arg.startsWith("--disable-features="),
  );
  assert.equal(featureSwitches[0], original + ",TcpPortRandomizationWin");
  assert.deepEqual(
    effective.filter((arg) => !featureSwitches.includes(arg)),
    defaults.filter((arg) => arg !== original),
  );
});
