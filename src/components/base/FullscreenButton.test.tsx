import { act, fireEvent, render, screen } from "@testing-library/react";
import FullscreenButton from "./FullscreenButton";

const originalEnabled = Object.getOwnPropertyDescriptor(
  document,
  "fullscreenEnabled",
);
const originalElement = Object.getOwnPropertyDescriptor(
  document,
  "fullscreenElement",
);
const originalRequest = document.documentElement.requestFullscreen;
const originalExit = document.exitFullscreen;

afterEach(() => {
  for (const [key, descriptor] of [
    ["fullscreenEnabled", originalEnabled],
    ["fullscreenElement", originalElement],
  ] as const) {
    if (descriptor) Object.defineProperty(document, key, descriptor);
    else Reflect.deleteProperty(document, key);
  }
  document.documentElement.requestFullscreen = originalRequest;
  document.exitFullscreen = originalExit;
});

function supportFullscreen() {
  Object.defineProperty(document, "fullscreenEnabled", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    writable: true,
    value: null,
  });
  const setElement = (value: Element | null) => {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      writable: true,
      value,
    });
    document.dispatchEvent(new Event("fullscreenchange"));
  };
  document.documentElement.requestFullscreen = jest.fn(async () =>
    setElement(document.documentElement),
  );
  document.exitFullscreen = jest.fn(async () => setElement(null));
  return setElement;
}

it("uses actual fullscreen state, including browser Esc, rather than a stored toggle", async () => {
  const setElement = supportFullscreen();
  render(<FullscreenButton />);
  fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
  expect(
    await screen.findByRole("button", { name: "Exit fullscreen" }),
  ).toBeEnabled();
  expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Exit fullscreen" }));
  expect(
    await screen.findByRole("button", { name: "Enter fullscreen" }),
  ).toBeEnabled();
  expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
  act(() => setElement(document.documentElement));
  act(() => setElement(null));
  expect(
    screen.getByRole("button", { name: "Enter fullscreen" }),
  ).toBeEnabled();
});

it("keeps the current state on rejection and permits another attempt", async () => {
  supportFullscreen();
  document.documentElement.requestFullscreen = jest
    .fn()
    .mockRejectedValueOnce(new Error("Denied"))
    .mockResolvedValue(undefined);
  render(<FullscreenButton />);
  fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Fullscreen could not change",
  );
  expect(
    screen.getByRole("button", { name: "Enter fullscreen" }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
  await act(async () => undefined);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("explains why fullscreen is unavailable without offering a pretend setting", () => {
  render(<FullscreenButton />);
  expect(
    screen.getByRole("button", { name: "Enter fullscreen" }),
  ).toBeDisabled();
  expect(screen.getByText("Unavailable in this browser.")).toBeVisible();
});
