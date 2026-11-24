import { expect, test } from "@playwright/test";
import {
  closeDesktop,
  createDesktopProfile,
  launchDesktop,
  removeDesktopProfile,
} from "./desktop-fixture";
import type { DesktopSession } from "./desktop-fixture";

test("the packaged offline renderer keeps online hosting unavailable", async () => {
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
      lobby.getByRole("button", { name: "Host a game" }),
    ).toBeDisabled();
    await expect(
      lobby.getByRole("button", { name: "Local Co-op" }),
    ).toHaveCount(0);
  } finally {
    try {
      if (desktop) await closeDesktop(desktop, { force: true });
    } finally {
      await removeDesktopProfile(profile);
    }
  }
});
