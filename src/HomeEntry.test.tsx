import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Home } from "./HomeEntry";
const mockAction = jest.fn();
const mockUnlock = jest.fn();
jest.mock("./AudioContext", () => ({ unlockAudioContext: () => mockUnlock() }));
const mockLoaded = jest.fn();
jest.mock("./Root", () => ({ root: { render: jest.fn() } }));
jest.mock("./GameEntry", () => {
  mockLoaded();
  return { runHomeAction: (...args: unknown[]) => mockAction(...args) };
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
