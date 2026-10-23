import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import DesktopDisplaySettings from "./DesktopDisplaySettings";
import { DesktopBridge, DesktopState } from "../../Desktop";
import { updateInputPresentation } from "../../desktop/InputPresentation";

let update: ((state: DesktopState) => void) | undefined;
const state: DesktopState = {
  display: {
    fullscreen: true,
    width: 1280,
    height: 720,
    resolutions: [
      { width: 1280, height: 720 },
      { width: 800, height: 600 },
    ],
  },
  steam: { available: false, online: false, cloudEnabled: false },
};
beforeEach(() => {
  window.electrifyDesktop = {
    apiVersion: 1,
    getState: jest.fn().mockResolvedValue(state),
    onStateChanged: jest.fn((callback) => {
      update = callback;
      return () => {
        update = undefined;
      };
    }),
    setDisplay: jest.fn(async (next) => ({ ...state.display, ...next })),
  } as unknown as DesktopBridge;
});
afterEach(() => {
  act(() => updateInputPresentation({ active: false }));
  delete window.electrifyDesktop;
});
it("keeps fullscreen instructions appropriate to the active input device", async () => {
  render(<DesktopDisplaySettings />);
  await waitFor(() =>
    expect(screen.getByRole("switch", { name: "Fullscreen" })).toBeEnabled(),
  );
  expect(screen.getByText(/F11 or Alt\+Enter/)).toBeInTheDocument();
  act(() => updateInputPresentation({ active: true }));
  expect(screen.queryByText(/F11 or Alt\+Enter/)).not.toBeInTheDocument();
  expect(screen.getByText(/monitor's native resolution/)).toBeInTheDocument();
});
it("describes native fullscreen and saves a window size through the preload bridge", async () => {
  render(<DesktopDisplaySettings />);
  await waitFor(() =>
    expect(screen.getByRole("switch", { name: "Fullscreen" })).toBeChecked(),
  );
  expect(
    screen.queryByRole("combobox", { name: "Resolution" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/monitor's native resolution/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("switch", { name: "Fullscreen" }));
  await waitFor(() =>
    expect(window.electrifyDesktop?.setDisplay).toHaveBeenCalledWith(
      expect.objectContaining({ fullscreen: false, width: 1280, height: 720 }),
    ),
  );
  act(() =>
    update?.({ ...state, display: { ...state.display, fullscreen: false } }),
  );
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Resolution" })).toBeEnabled(),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Resolution" }), {
    target: { value: "800x600" },
  });
  await waitFor(() =>
    expect(window.electrifyDesktop?.setDisplay).toHaveBeenLastCalledWith(
      expect.objectContaining({ fullscreen: false, width: 800, height: 600 }),
    ),
  );
});
it("shows intent while pending, rolls back a rejected request, and allows retry", async () => {
  const failed = deferred();
  (window.electrifyDesktop?.setDisplay as jest.Mock).mockReturnValueOnce(
    failed.promise,
  );
  render(<DesktopDisplaySettings />);
  const fullscreen = screen.getByRole("switch", { name: "Fullscreen" });
  await waitFor(() => expect(fullscreen).toBeEnabled());
  act(() => fullscreen.focus());
  fireEvent.click(fullscreen);
  expect(fullscreen).not.toBeChecked();
  expect(fullscreen).toHaveFocus();
  expect(fullscreen).toHaveAttribute("aria-busy", "true");
  await act(async () => failed.reject(new Error("denied")));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't change the display. Try again.",
  );
  expect(window.electrifyDesktop?.getState).toHaveBeenCalledTimes(2);
  expect(fullscreen).toBeChecked();
  expect(fullscreen).toHaveFocus();
  expect(fullscreen).toBeEnabled();
  expect(fullscreen).toHaveAttribute("aria-busy", "false");
  fireEvent.click(fullscreen);
  await waitFor(() => expect(fullscreen).toHaveAttribute("aria-busy", "false"));
  expect(fullscreen).not.toBeChecked();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

function deferred() {
  let resolve!: (value: DesktopState["display"]) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<DesktopState["display"]>((finish, fail) => {
    resolve = finish;
    reject = fail;
  });
  return { promise, resolve, reject };
}

it("keeps focus and displays the canonical native result before later shortcuts take over", async () => {
  const pending = deferred();
  (window.electrifyDesktop?.setDisplay as jest.Mock).mockReturnValue(
    pending.promise,
  );
  render(<DesktopDisplaySettings />);
  const fullscreen = await screen.findByRole("switch", { name: "Fullscreen" });
  await waitFor(() => expect(fullscreen).toBeEnabled());
  act(() => fullscreen.focus());
  fireEvent.click(fullscreen);
  expect(fullscreen).toHaveFocus();
  expect(fullscreen).toBeEnabled();
  expect(fullscreen).not.toBeChecked();
  expect(fullscreen).toHaveAttribute("aria-busy", "true");
  expect(window.electrifyDesktop?.setDisplay).toHaveBeenCalledTimes(1);
  await act(async () =>
    pending.resolve({
      ...state.display,
      fullscreen: false,
      width: 800,
      height: 600,
    }),
  );
  expect(fullscreen).toHaveFocus();
  expect(fullscreen).toHaveAttribute("aria-busy", "false");
  expect(fullscreen).not.toBeChecked();
  expect(screen.getByRole("combobox", { name: "Resolution" })).toHaveValue(
    "800x600",
  );
  act(() => update?.({ ...state, display: { ...state.display } }));
  expect(fullscreen).toBeChecked();
  expect(
    screen.queryByRole("combobox", { name: "Resolution" }),
  ).not.toBeInTheDocument();
});

it("serializes the latest fullscreen and resolution intent without reverting it on earlier native events", async () => {
  const first = deferred();
  const second = deferred();
  const setDisplay = window.electrifyDesktop?.setDisplay as jest.Mock;
  setDisplay
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  render(<DesktopDisplaySettings />);
  const fullscreen = screen.getByRole("switch", { name: "Fullscreen" });
  await waitFor(() => expect(fullscreen).toBeEnabled());
  fireEvent.click(fullscreen);
  fireEvent.click(fullscreen);
  expect(fullscreen).toBeChecked();
  fireEvent.click(fullscreen);
  expect(fullscreen).not.toBeChecked();
  const resolution = screen.getByRole("combobox", { name: "Resolution" });
  act(() => resolution.focus());
  fireEvent.change(resolution, { target: { value: "800x600" } });
  fireEvent.change(resolution, { target: { value: "800x600" } });
  expect(resolution).toHaveValue("800x600");
  expect(resolution).toHaveFocus();
  expect(resolution).toBeEnabled();
  expect(resolution).toHaveAttribute("aria-busy", "true");
  expect(setDisplay).toHaveBeenCalledTimes(1);
  act(() => update?.({ ...state, display: { ...state.display } }));
  expect(fullscreen).not.toBeChecked();
  expect(resolution).toHaveValue("800x600");
  await act(async () => first.resolve({ ...state.display, fullscreen: false }));
  expect(setDisplay).toHaveBeenCalledTimes(2);
  expect(setDisplay).toHaveBeenLastCalledWith(
    expect.objectContaining({ fullscreen: false, width: 800, height: 600 }),
  );
  expect(resolution).toHaveValue("800x600");
  expect(resolution).toHaveFocus();
  await act(async () =>
    second.resolve({
      ...state.display,
      fullscreen: false,
      width: 800,
      height: 600,
    }),
  );
  expect(resolution).toHaveAttribute("aria-busy", "false");
  expect(resolution).toHaveFocus();
  expect(resolution).toHaveValue("800x600");
});

it("applies a deliberate second fullscreen toggle after the first request", async () => {
  const first = deferred();
  const second = deferred();
  const setDisplay = window.electrifyDesktop?.setDisplay as jest.Mock;
  setDisplay
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  render(<DesktopDisplaySettings />);
  const fullscreen = screen.getByRole("switch", { name: "Fullscreen" });
  await waitFor(() => expect(fullscreen).toBeEnabled());
  fireEvent.click(fullscreen);
  fireEvent.click(fullscreen);
  expect(fullscreen).toBeChecked();
  expect(setDisplay).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve({ ...state.display, fullscreen: false }));
  expect(setDisplay).toHaveBeenCalledTimes(2);
  expect(setDisplay).toHaveBeenLastCalledWith(
    expect.objectContaining({ fullscreen: true }),
  );
  expect(fullscreen).toBeChecked();
  await act(async () => second.resolve(state.display));
  expect(fullscreen).toHaveAttribute("aria-busy", "false");
});

it("keeps the last confirmed display if a queued change fails and native state cannot be read", async () => {
  const first = deferred();
  const second = deferred();
  const setDisplay = window.electrifyDesktop?.setDisplay as jest.Mock;
  setDisplay
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  render(<DesktopDisplaySettings />);
  const fullscreen = screen.getByRole("switch", { name: "Fullscreen" });
  await waitFor(() => expect(fullscreen).toBeEnabled());
  fireEvent.click(fullscreen);
  const resolution = screen.getByRole("combobox", { name: "Resolution" });
  act(() => resolution.focus());
  fireEvent.change(resolution, { target: { value: "800x600" } });
  await act(async () => first.resolve({ ...state.display, fullscreen: false }));
  (window.electrifyDesktop?.getState as jest.Mock).mockRejectedValueOnce(
    new Error("native state unavailable"),
  );
  await act(async () => second.reject(new Error("denied")));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't change the display. Try again.",
  );
  expect(fullscreen).not.toBeChecked();
  expect(resolution).toHaveValue("1280x720");
  expect(resolution).toHaveFocus();
  expect(resolution).toHaveAttribute("aria-busy", "false");
});

it("reflects the actual native display after both applying and rolling back fail", async () => {
  const failed = deferred();
  const actual: DesktopState = {
    ...state,
    display: { ...state.display, fullscreen: false, width: 800, height: 600 },
  };
  (window.electrifyDesktop?.getState as jest.Mock)
    .mockResolvedValueOnce(state)
    .mockResolvedValue(actual);
  (window.electrifyDesktop?.setDisplay as jest.Mock).mockReturnValueOnce(
    failed.promise,
  );
  render(<DesktopDisplaySettings />);
  const fullscreen = screen.getByRole("switch", { name: "Fullscreen" });
  await waitFor(() => expect(fullscreen).toBeEnabled());
  act(() => fullscreen.focus());
  fireEvent.click(fullscreen);
  expect(fullscreen).not.toBeChecked();
  const resolution = screen.getByRole("combobox", { name: "Resolution" });
  expect(resolution).toHaveValue("1280x720");
  await act(async () => failed.reject(new Error("apply and rollback failed")));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't change the display. Try again.",
  );
  expect(fullscreen).not.toBeChecked();
  expect(fullscreen).toHaveFocus();
  expect(fullscreen).toHaveAttribute("aria-busy", "false");
  expect(resolution).toHaveValue("800x600");
  expect(resolution).toBeEnabled();
  expect(window.electrifyDesktop?.getState).toHaveBeenCalledTimes(2);
});
