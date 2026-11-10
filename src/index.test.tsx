import { render, screen, waitFor } from "@testing-library/react";

const mockRender = jest.fn();
let mockChunkFailure = false;
jest.mock("react-dom/client", () => {
  const actual = jest.requireActual("react-dom/client");
  return {
    ...actual,
    createRoot: (container: HTMLElement) =>
      container.id === "root"
        ? { render: mockRender }
        : actual.createRoot(container),
  };
});
jest.mock("./App", () => () => null);
jest.mock("./Store", () => ({ store: {} }));
jest.mock("./FocusVisibility", () => ({ installFocusVisibility: () => {} }));
jest.mock("./Desktop", () => ({
  getDesktop: () => undefined,
  isDesktopApp: () => true,
}));
jest.mock("./couch/Seat", () => {
  if (mockChunkFailure) throw new Error("Seat chunk unavailable");
  return { __esModule: true, default: () => null };
});

const desktopBuild = process.env.REACT_APP_DESKTOP;
beforeEach(() => {
  jest.resetModules();
  mockRender.mockReset();
  mockChunkFailure = false;
  process.env.REACT_APP_DESKTOP = "true";
  document.body.innerHTML =
    '<div id="root"></div><div id="appStartup"><span role="status">Loading this company</span></div>';
  window.electrifyCouch = {
    role: "seat",
    seatId: "local-p1",
    getGeneration: () => 1,
    ready: jest.fn().mockResolvedValue(undefined),
    onMessage: () => () => {},
    post: () => {},
  };
});
afterEach(() => {
  if (desktopBuild === undefined) delete process.env.REACT_APP_DESKTOP;
  else process.env.REACT_APP_DESKTOP = desktopBuild;
  delete window.electrifyCouch;
  document.body.replaceChildren();
});

it.each(["native readiness", "seat chunk"])(
  "replaces the startup splash with an actionable error after failed %s",
  async (failure) => {
    if (failure === "native readiness")
      window.electrifyCouch!.ready = jest
        .fn()
        .mockRejectedValue(new Error("Port unavailable"));
    else mockChunkFailure = true;
    require("./index");
    await waitFor(() => expect(mockRender).toHaveBeenCalledTimes(1));
    render(mockRender.mock.calls[0][0]);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "could not finish loading",
    );
    expect(
      screen.getByRole("button", { name: "Reload this company" }),
    ).toBeVisible();
    expect(screen.queryByRole("status")).toBeNull();
  },
);

it("renders the company normally after native readiness and the seat chunk load", async () => {
  require("./index");
  await waitFor(() => expect(mockRender).toHaveBeenCalledTimes(1));
  expect(window.electrifyCouch!.ready).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent("Loading this company");
});
