import * as React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { TextEncoder } from "util";
import type { DesktopBridge } from "../../Desktop";
import type { ModPackage } from "../../mods/ModSchema";
import type { InstalledMod } from "../../mods/Types";
import uiReducer from "../../reducers/UI";
import Mods from "./Mods";

const mockPrepare = jest.fn();
const mockValidation = jest.fn<[], unknown[]>(() => []);
jest.mock("../../mods/ModScenario", () => ({
  modIssue: () => undefined,
  modScenario: jest.fn(),
  modValidationDiagnostics: (...args: unknown[]) => mockValidation(...args),
  prepareModStartingPeak: (...args: unknown[]) => mockPrepare(...args),
}));
jest.mock("../../reducers/Game", () => ({ launchCustomScenario: jest.fn() }));
jest.mock("./StartGame", () => ({ startWithSaveGuard: jest.fn() }));
Object.assign(global, { TextEncoder });

function entry(id: string, share = true): InstalledMod {
  const pack: ModPackage = {
    schemaVersion: 1,
    gameApi: 1,
    id,
    title: id,
    creator: "Ada",
    version: "1.0.0",
    description: "A grid with a new campus.",
    seed: 42,
    baseScenarioId: 999,

    ...(share
      ? {
          events: [
            {
              id: "connection",
              title: "Campus connection",
              message: "The campus connects.",
              preview: "The campus will connect.",
              startMonth: 2,
              loads: [
                {
                  id: "campus",
                  startMonth: 2,
                  demandType: "Data Centers",
                  loadFactor: 0.8,
                  peakShareOfStartingPeak: 0.5,
                },
              ],
            },
          ],
        }
      : {}),
  };
  return { key: `local:${id}`, source: "local", enabled: true, pack };
}

function setup(entries: InstalledMod[]) {
  const state = {
    display: { fullscreen: false, width: 1, height: 1, resolutions: [] },
    steam: { available: true, online: false, cloudEnabled: false },
  };
  window.electrifyDesktop = {
    apiVersion: 1,
    mods: jest.fn(async () => ({ entries })),
    getState: async () => state,
    onStateChanged: () => () => {},
  } as unknown as DesktopBridge;
  const store = configureStore({
    reducer: { ui: uiReducer, game: () => ({ difficulty: "VP" }) },
  });
  return render(
    <Provider store={store}>
      <Mods />
    </Provider>,
  );
}

beforeEach(() => {
  mockPrepare.mockReset().mockResolvedValue(undefined);
  mockValidation.mockClear();
});
afterEach(() => {
  delete window.electrifyDesktop;
});

it("prepares every mod's real baseline before exposing its launch details", async () => {
  setup([entry("ordinary-grid", false)]);
  expect(
    await screen.findByRole("button", { name: "Play ordinary-grid" }),
  ).toBeEnabled();
  expect(mockPrepare).toHaveBeenCalledWith(entry("ordinary-grid", false).pack);
});

it("shows preparation until the baseline is ready, then validates and enables play", async () => {
  let finish: (() => void) | undefined;
  mockPrepare.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  setup([entry("campus-grid")]);
  expect(await screen.findByText("Preparing scenario…")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Play campus-grid" })).toBeNull();
  expect(mockValidation).not.toHaveBeenCalled();
  await act(async () => finish!());
  expect(
    await screen.findByRole("button", { name: "Play campus-grid" }),
  ).toBeEnabled();
  expect(screen.queryByText("Preparing scenario…")).toBeNull();
  expect(mockValidation).toHaveBeenCalled();
});

it("shows a download failure and supports retry before play becomes available", async () => {
  let finish: (() => void) | undefined;
  mockPrepare
    .mockRejectedValueOnce(new Error("Could not load the weather: offline"))
    .mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
  setup([entry("retry-grid")]);
  expect(
    await screen.findByText("Could not load the weather: offline"),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Play retry-grid" })).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Retry preparation" }),
  );
  expect(await screen.findByText("Preparing scenario…")).toBeVisible();
  expect(screen.queryByText("Could not load the weather: offline")).toBeNull();
  await act(async () => finish!());
  expect(
    await screen.findByRole("button", { name: "Play retry-grid" }),
  ).toBeEnabled();
  expect(mockPrepare).toHaveBeenCalledTimes(2);
});

it("prepares share-based mods sequentially before validating each one", async () => {
  const finish = new Map<string, () => void>();
  mockPrepare.mockImplementation(
    (pack: ModPackage) =>
      new Promise<void>((resolve) => {
        finish.set(pack.id, resolve);
      }),
  );
  setup([entry("first-location"), entry("second-location")]);
  await waitFor(() => expect(mockPrepare).toHaveBeenCalledTimes(1));
  expect(mockPrepare.mock.calls[0][0].id).toBe("first-location");
  await act(async () => finish.get("first-location")!());
  expect(
    await screen.findByRole("button", { name: "Play first-location" }),
  ).toBeEnabled();
  await waitFor(() => expect(mockPrepare).toHaveBeenCalledTimes(2));
  expect(
    screen.queryByRole("button", { name: "Play second-location" }),
  ).toBeNull();
  await act(async () => finish.get("second-location")!());
  expect(
    await screen.findByRole("button", { name: "Play second-location" }),
  ).toBeEnabled();
});

it("also prepares a share-based replacement declared only in a choice", async () => {
  const grid = entry("choice-grid", false);
  grid.pack.events = [
    {
      id: "arrival",
      title: "Campus arrival",
      message: "The campus connects.",
      preview: "The campus will connect.",
      startMonth: 3,
      loads: [
        {
          id: "future-campus",
          startMonth: 3,
          demandType: "Data Centers",
          loadFactor: 0.8,
          peakMW: 10,
        },
      ],
    },
  ];
  grid.pack.choices = [
    {
      id: "connection",
      dueMonth: 1,
      title: "Connection",
      prompt: "Choose a connection.",
      options: [
        {
          id: "phased",
          label: "Phased",
          description: "Connect later.",
          message: "A phased campus was selected.",
          costDollars: 0,
          replaceLoad: {
            loadId: "future-campus",
            with: [
              {
                id: "phase-one",
                startMonth: 3,
                demandType: "Data Centers",
                loadFactor: 0.8,
                peakShareOfStartingPeak: 0.25,
              },
            ],
          },
        },
        {
          id: "standard",
          label: "Standard",
          description: "Keep the standard connection.",
          message: "The standard connection was selected.",
          costDollars: 0,
        },
      ],
    },
  ];
  setup([grid]);
  expect(
    await screen.findByRole("button", { name: "Play choice-grid" }),
  ).toBeEnabled();
  expect(mockPrepare).toHaveBeenCalledWith(grid.pack);
});
