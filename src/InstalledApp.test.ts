/** @jest-environment node */
import { isInstalledWebApp } from "./InstalledApp";

it("does not treat a Node simulation or test collector as an installed app", () => {
  expect(isInstalledWebApp()).toBe(false);
});
