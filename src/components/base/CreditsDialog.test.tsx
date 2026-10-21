import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CreditsDialog from "./CreditsDialog";

jest.mock("../../Desktop", () => ({ isDesktopApp: () => true }));

const fetchNotices = jest.fn();
const originalFetch = global.fetch;
const originalDesktop = process.env.REACT_APP_DESKTOP;
const notices = [
  {
    title: "Electrify game license",
    text: "Game license terms with Commons Clause",
  },
  {
    title: "Example dependency",
    text: "Retain this dependency copyright notice",
  },
];

beforeEach(() => {
  process.env.REACT_APP_DESKTOP = "true";
  global.fetch = fetchNotices;
  fetchNotices.mockReset();
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env.REACT_APP_DESKTOP = originalDesktop;
});

it("reads bundled notices without external navigation and displays desktop privacy offline", async () => {
  fetchNotices.mockResolvedValue({
    ok: true,
    json: async () => ({ notices, chromium: false }),
  });
  const onClose = jest.fn();
  render(<CreditsDialog onClose={onClose} />);
  const summary = await screen.findByText("Electrify game license");
  expect(fetchNotices).toHaveBeenCalledWith("/notices.json");
  expect(
    screen.getByRole("heading", { name: "Desktop privacy" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/no Google sign-in or Firebase analytics/),
  ).toBeVisible();
  await userEvent.click(summary);
  expect(screen.getByText(notices[0].text)).toBeVisible();
  await userEvent.click(screen.getByText("Example dependency"));
  expect(screen.getByText(notices[1].text)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("reports a missing bundled notice without closing the credits", async () => {
  fetchNotices.mockResolvedValue({ ok: false });
  render(<CreditsDialog onClose={() => undefined} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "bundled notices could not be loaded",
  );
  expect(
    screen.getByRole("dialog", { name: "Credits and licenses" }),
  ).toBeVisible();
});

it("shows Chromium attribution as inert local text rather than running its HTML", async () => {
  fetchNotices.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ notices, chromium: true }),
  });
  fetchNotices.mockResolvedValueOnce({
    ok: true,
    text: async () =>
      '<div class="product"><span class="title">Chromium Example</span><div class="license">Original runtime notice &amp; terms</div><script>window.chromiumScriptExecuted = true</script><img src="https://example.invalid/track"></div>',
  });
  render(<CreditsDialog onClose={() => undefined} />);
  await userEvent.click(
    await screen.findByText("Chromium third-party licenses"),
  );
  await userEvent.click(await screen.findByText("Chromium Example"));
  expect(screen.getByText("Original runtime notice & terms")).toBeVisible();
  expect(fetchNotices).toHaveBeenLastCalledWith("/notices-chromium.html");
  expect(screen.queryByRole("img")).toBeNull();
  expect(window.frames.length).toBe(0);
});
