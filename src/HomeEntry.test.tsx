import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Home, showHome } from "./HomeEntry";
import { root } from "./Root";
const mockAction = jest.fn();
const mockUnlock = jest.fn();
jest.mock("./AudioContext", () => ({ unlockAudioContext: () => mockUnlock() }));
const mockLoaded = jest.fn();
const mockPendingPrompt = jest.fn();
jest.mock("./InstallPromptEvent", () => ({
  getPendingInstallPrompt: () => mockPendingPrompt(),
}));
jest.mock("./Root", () => ({ root: { render: jest.fn() } }));
jest.mock("./GameEntry", () => {
  mockLoaded();
  return { runHomeAction: (...args: unknown[]) => mockAction(...args) };
});
it("hands an install prompt captured before mounting to the full app", async () => {
  mockPendingPrompt.mockReturnValueOnce(new Event("beforeinstallprompt"));
  render(<Home />);
  await waitFor(() => expect(mockLoaded).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  mockLoaded.mockClear();
});

it("settles a stylesheet error and offers recovery instead of leaving a stale pending marker", async () => {
  const style = document.createElement("link");
  style.setAttribute("data-app-style", "");
  document.head.append(style);
  const startup = document.createElement("div");
  startup.dataset.startupStatus = "";
  document.body.append(startup);
  try {
    showHome();
    fireEvent.error(style);
    await screen.findByRole("alert");
    expect(style).not.toHaveAttribute("data-app-style");
    expect(root.render).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "couldn't finish loading",
    );
    expect(
      screen.getByRole("button", { name: "Reload Electrify" }),
    ).toBeVisible();
  } finally {
    style.remove();
    startup.remove();
    jest.mocked(root.render).mockClear();
  }
});
it("shows crawlable links without the engine and retries a failed first intent", async () => {
  render(<Home />);
  expect(
    screen.getByRole("navigation", { name: "Explore Electrify" }),
  ).toBeVisible();
  expect(mockLoaded).not.toHaveBeenCalled();
  mockAction.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: /^Play$/ }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("could not load"),
  );
  expect(mockAction).toHaveBeenCalledWith("onStart", undefined);
  mockAction.mockResolvedValueOnce(undefined);
  fireEvent.click(screen.getByRole("button", { name: "Turn on sound" }));
  expect(mockUnlock).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(mockAction).toHaveBeenCalledTimes(2));
  expect(mockAction).toHaveBeenLastCalledWith("onAudioChange", true);
});
