import { waitForAppStyles } from "./StartupStyles";

afterEach(() => document.head.replaceChildren());

it("rejects a failure recorded before an entry starts waiting", async () => {
  const style = document.createElement("link");
  style.dataset.appStyleError = "true";
  document.head.append(style);
  await expect(waitForAppStyles()).rejects.toThrow("stylesheet unavailable");
});

it("settles a pending stylesheet load and clears its pending marker", async () => {
  const style = document.createElement("link");
  style.dataset.appStyle = "";
  document.head.append(style);
  const waiting = waitForAppStyles();
  style.dispatchEvent(new Event("load"));
  await expect(waiting).resolves.toBeUndefined();
  expect(style).not.toHaveAttribute("data-app-style");
  await expect(waitForAppStyles()).resolves.toBeUndefined();
});

it("settles a pending stylesheet failure and makes a later waiter reject immediately", async () => {
  const style = document.createElement("link");
  style.dataset.appStyle = "";
  document.head.append(style);
  const waiting = waitForAppStyles();
  style.dispatchEvent(new Event("error"));
  await expect(waiting).rejects.toThrow("stylesheet unavailable");
  expect(style).not.toHaveAttribute("data-app-style");
  await expect(waitForAppStyles()).rejects.toThrow("stylesheet unavailable");
});

it("proceeds when a stylesheet has already loaded", async () => {
  const style = document.createElement("link");
  style.dataset.appStyle = "";
  Object.defineProperty(style, "sheet", { value: {} });
  document.head.append(style);
  expect(style.sheet).not.toBeNull();
  await expect(waitForAppStyles()).resolves.toBeUndefined();
});
