const { browserLaunchOptions } = require("../scripts/ci/browser-launch");
import { chromium, expect, test } from "@playwright/test";

// This runs on every OS: Chromium's repeated-switch semantics are platform independent.
test("the Windows workaround preserves the browser's effective default features", async () => {
  const defaults = await chromium.launch({ args: ["--enable-automation"] });
  const options = browserLaunchOptions("win32");
  let mitigated: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    mitigated = await chromium.launch({
      ...options,
      args: [...options.args, "--enable-automation"],
    });
    const commandLine = async (
      browser: Awaited<ReturnType<typeof chromium.launch>>,
    ) => {
      const session = await browser.newBrowserCDPSession();
      const { arguments: args } = await session.send(
        "Browser.getBrowserCommandLine",
      );
      await session.detach();
      return args.filter((arg: string) =>
        arg.startsWith("--disable-features="),
      );
    };
    const original = await commandLine(defaults);
    const actual = await commandLine(mitigated);
    expect(original).toHaveLength(1);
    expect(actual).toEqual([original[0] + ",TcpPortRandomizationWin"]);
  } finally {
    await mitigated?.close();
    await defaults.close();
  }
});
