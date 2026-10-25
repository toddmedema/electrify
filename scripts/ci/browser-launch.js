/** Work around Chromium's Windows loopback allocator defect, not request failures.
 * https://issues.chromium.org/issues/572515601
 * Chromium keeps only the last --disable-features argument. Preserve the locked
 * Playwright runtime's entire list rather than silently replacing its defaults.
 */
function browserLaunchOptions(platform = process.platform) {
  if (platform !== "win32") return {};
  // Playwright has no public additive feature API. This small, checked adapter is
  // intentionally isolated; browser-environment.spec.ts verifies the actual launch.
  const { server } = require("playwright-core/lib/coreBundle");
  const chromium = server.createPlaywright({
    sdkLanguage: "javascript",
  }).chromium;
  const defaults = chromium._innerDefaultArgs({});
  const features = defaults.filter((arg) =>
    arg.startsWith("--disable-features="),
  );
  if (features.length !== 1)
    throw new Error(
      "Playwright's Chromium defaults changed; review the Windows loopback workaround",
    );
  const original = features[0];
  return {
    ignoreDefaultArgs: [original],
    args: [original + ",TcpPortRandomizationWin"],
  };
}
module.exports = { browserLaunchOptions };
