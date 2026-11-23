import { expect, test } from "@playwright/test";
import type { Server } from "node:http";
import {
  closeDesktop,
  createDesktopProfile,
  launchDesktop,
  removeDesktopProfile,
} from "./desktop-fixture";
import type { DesktopSession } from "./desktop-fixture";

test("the packaged renderer can host on the configured cross-play relay", async () => {
  const port = Number(process.env.CROSSPLAY_TEST_RELAY_PORT);
  test.skip(!port, "The packaged CI renderer has a dedicated relay endpoint.");

  const { server, sockets } = require("../relay/server.cjs").createRelay({
    origins: ["electrify://app"],
  }) as {
    server: Server;
    sockets: { clients: Set<{ terminate(): void }> };
  };
  const origins: (string | undefined)[] = [];
  server.on("upgrade", (request) => origins.push(request.headers.origin));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  const profile = await createDesktopProfile();
  let desktop: DesktopSession | undefined;
  try {
    desktop = await launchDesktop(profile);
    const { page } = desktop;
    await page
      .getByRole("button", { name: "Play with friends", exact: true })
      .click();
    const lobby = page.getByRole("dialog", { name: "Play with friends" });
    await expect(
      lobby.getByRole("button", { name: "Local Co-op" }),
    ).toHaveCount(0);
    await lobby
      .getByRole("button", { name: "Host a game", exact: true })
      .click();
    const bar = page.getByRole("region", { name: "Playing together" }).last();
    await expect(bar.getByText(/^\d{6}$/, { exact: true })).toBeVisible();
    expect(origins).toEqual(["electrify://app"]);
  } finally {
    try {
      if (desktop) await closeDesktop(desktop, { force: true });
    } finally {
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await removeDesktopProfile(profile);
    }
  }
});
