import * as React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InstallAppButton, { InstallPromptProvider } from "./InstallAppButton";

afterEach(() => {
  jest.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

it("keeps the app usable when storage reads are blocked", () => {
  jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Blocked", "SecurityError");
  });
  render(
    <InstallPromptProvider>
      <div>Game</div>
      <InstallAppButton />
    </InstallPromptProvider>,
  );
  expect(screen.getByText("Game")).toBeInTheDocument();
});

it("handles install dismissal and completion when persistence writes fail", async () => {
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new DOMException("Blocked", "SecurityError");
  });
  render(
    <InstallPromptProvider>
      <InstallAppButton />
    </InstallPromptProvider>,
  );
  const prompt = jest.fn().mockResolvedValue(undefined);
  act(() => {
    window.dispatchEvent(
      Object.assign(new Event("beforeinstallprompt"), {
        prompt,
        userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
      }),
    );
  });
  await userEvent.click(screen.getByRole("button", { name: "Install app" }));
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("button", { name: "Install app" }),
  ).not.toBeInTheDocument();
  act(() => {
    window.dispatchEvent(new Event("appinstalled"));
  });
});
