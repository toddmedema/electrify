import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { TextEncoder } from "util";
import type { DesktopBridge, DesktopState } from "../../Desktop";
import type { CoopSelectionType } from "../../Types";
import type { ModPackage } from "../../mods/ModSchema";
import type { ModLibrary } from "../../mods/Types";
import { modScenario } from "../../mods/ModScenario";
import { objectiveDefinition } from "../../helpers/ScenarioObjectives";
import { modBrowseSummary } from "../../multiplayer/ModBrowse";
import { registerCoopControls } from "../../multiplayer/Registry";
import uiReducer, { delta } from "../../reducers/UI";
import Mods from "./Mods";
import CoopModPreview, { KeepModCopy } from "./CoopModPreview";

Object.assign(global, { TextEncoder });
const controls = {
  start: jest.fn(),
  ready: jest.fn(),
  back: jest.fn(),
  invite: jest.fn(),
  copyCode: jest.fn(),
  openSaves: jest.fn(),
};
const pack: ModPackage = {
  schemaVersion: 1,
  gameApi: 1,
  id: "guest-preview",
  title: "Connection planning",
  creator: "Fixture author",
  version: "1.2",
  description: "Plan the connection for your grid.",
  seed: 42,
  baseScenarioId: 999,
  officialArcs: [],
  scenario: { durationMonths: 6 },
  objectives: {
    mode: "replace",
    items: [
      {
        id: "reliable",
        label: "Serve your customers",
        metric: "monthlyReliability",
        fromMonth: 1,
        throughMonth: 6,
        minDemandServedShare: 0.99,
      },
      {
        id: "bills",
        label: "Keep bills affordable",
        metric: "monthlyBilledRate",
        fromMonth: 2,
        throughMonth: 6,
        maxDollarsPerKWh: 0.2,
        required: false,
      },
    ],
  },
  events: [
    {
      id: "announced",
      title: "Announced cost support",
      message: "Costs fall.",
      preview: "Costs will fall for your grid.",
      visibility: "forecast",
      startMonth: 2,
      durationMonths: 2,
      effects: { operatingCostMultipliersByFuel: { "Natural Gas": 0.9 } },
    },
    {
      id: "secret",
      title: "Hidden fuel shock",
      message: "A hidden shock arrives.",
      visibility: "surprise",
      startMonth: 4,
      durationMonths: 1,
      effects: { fuelPriceMultipliers: { "Natural Gas": 1.2 } },
    },
  ],
  choices: [
    {
      id: "connection",
      title: "Connection funding",
      prompt: "Choose the funding for your grid.",
      dueMonth: 2,
      options: [
        {
          id: "accept",
          label: "Accept funding",
          description: "Accept company funding.",
          message: "Funding accepted.",
          grantDollars: 10000,
        },
        {
          id: "decline",
          label: "Keep the plan",
          description: "Keep the existing plan.",
          message: "Plan retained.",
          costDollars: 0,
        },
      ],
    },
  ],
};
const scenario = () => modScenario(pack, "777", "Employee");
const coop = (patch: Partial<CoopSelectionType> = {}): CoopSelectionType => ({
  role: "guest",
  hostName: "Ada",
  ready: false,
  starting: false,
  players: [
    { id: "a", name: "Ada", host: true, connected: true, ready: false },
    { id: "b", name: "Bo", host: false, connected: true, ready: false },
  ],
  ...patch,
});
let desktopStateReady: Promise<DesktopState>;
function desktop(online = true) {
  const mods = jest
    .fn<Promise<ModLibrary>, Parameters<NonNullable<DesktopBridge["mods"]>>>()
    .mockResolvedValue({ entries: [], message: "Subscribed on Workshop." });
  const state: DesktopState = {
    display: { fullscreen: false, width: 1280, height: 900, resolutions: [] },
    steam: { available: true, online, cloudEnabled: false },
  };
  desktopStateReady = Promise.resolve(state);
  window.electrifyDesktop = {
    apiVersion: 1,
    mods,
    getState: () => desktopStateReady,
    onStateChanged: () => () => {},
  } as unknown as DesktopBridge;
  return mods;
}
function setup(selection: CoopSelectionType, wrapper = false) {
  const store = configureStore({
    reducer: {
      ui: uiReducer,
      game: () => ({ difficulty: "Employee" }),
    },
  });
  store.dispatch(delta({ coop: selection }));
  const view = render(
    <Provider store={store}>
      {wrapper ? <Mods /> : <CoopModPreview coop={selection} />}
    </Provider>,
  );
  return { store, ...view };
}
beforeEach(() => {
  jest.clearAllMocks();
  registerCoopControls(controls);
});
afterEach(() => {
  registerCoopControls(undefined);
  delete window.electrifyDesktop;
});

test("a guest renders only the safe summary while the snapshot is arriving and cannot mark Ready", async () => {
  const mods = desktop();
  const selected = scenario();
  setup(
    coop({ modSummary: modBrowseSummary(selected), receivingScenario: true }),
    true,
  );
  expect(
    screen.getByRole("heading", { level: 1, name: "Connection planning" }),
  ).toBeVisible();
  expect(screen.getByText("By Fixture author · v1.2")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Receiving scenario…" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("region", { name: "Scenario objectives" }),
  ).toHaveTextContent(objectiveDefinition("monthlyBilledRate"));
  expect(
    screen.getByRole("region", { name: "Scenario objectives" }),
  ).toHaveTextContent("Optional");
  expect(
    screen.queryByRole("region", { name: "Author description" }),
  ).toBeNull();
  expect(
    screen.queryByRole("region", { name: "Announced timeline" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Keep a copy from Workshop" }),
  ).toBeNull();
  await act(async () => {
    await desktopStateReady;
  });
  expect(mods).not.toHaveBeenCalled();
  expect(controls.ready).not.toHaveBeenCalled();
});

test("a received snapshot shows author claims and announced facts while keeping hidden surprises hidden", async () => {
  const mods = desktop();
  const selected = scenario();
  setup(
    coop({
      modScenario: selected,
      modSummary: modBrowseSummary(selected),
      receivingScenario: false,
    }),
    true,
  );
  expect(
    screen.getByRole("region", { name: "Author description" }),
  ).toHaveTextContent(pack.description);
  const timeline = screen.getByRole("region", { name: "Announced timeline" });
  expect(timeline).toHaveTextContent("Announced cost support");
  expect(timeline).toHaveTextContent("Connection funding");
  expect(timeline).toHaveTextContent("Each company chooses");
  expect(timeline).toHaveTextContent("Month 2 · Feb 2020");
  expect(
    screen.queryByText(/Hidden fuel shock|A hidden shock arrives/),
  ).toBeNull();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Modded · Unranked · No achievements",
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Keep a copy from Workshop" }),
    ).toBeEnabled(),
  );
  expect(mods).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "I'm ready" }));
  expect(controls.ready).toHaveBeenCalledWith(true);
  expect(controls.start).not.toHaveBeenCalled();
  expect(mods).not.toHaveBeenCalled();
});

test("the host starts the exact frozen selection only after every guest is ready", async () => {
  desktop();
  const selected = scenario();
  const selection = coop({
    role: "host",
    modScenario: selected,
    modSummary: modBrowseSummary(selected),
  });
  const { rerender, store } = setup(selection);
  expect(
    screen.getByRole("button", { name: "Start for everyone" }),
  ).toBeDisabled();
  const ready = {
    ...selection,
    players: selection.players.map((player) => ({ ...player, ready: true })),
  };
  rerender(
    <Provider store={store}>
      <CoopModPreview coop={ready} />
    </Provider>,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Start for everyone" }),
  );
  expect(controls.start).toHaveBeenCalledWith({
    scenarioId: 999,
    difficulty: "Employee",
    customScenario: selected,
  });
  expect(
    screen.queryByRole("button", { name: "Keep a copy from Workshop" }),
  ).toBeNull();
});

test("unpublished snapshots explain host-local provenance without offering installation", async () => {
  const mods = desktop();
  const selected = modScenario(pack, undefined, "Employee");
  setup(
    coop({ modScenario: selected, modSummary: modBrowseSummary(selected) }),
  );
  await act(async () => {
    await desktopStateReady;
  });
  expect(screen.getByText("This is the host's local mod.")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Keep a copy from Workshop" }),
  ).toBeNull();
  expect(mods).not.toHaveBeenCalled();
});

test("keeping a copy is an explicit one-action subscription and an in-flight request cannot repeat", async () => {
  const mods = desktop();
  let finish: (result: ModLibrary) => void = () => {};
  mods.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<KeepModCopy scenario={scenario()} />);
  const button = screen.getByRole("button", {
    name: "Keep a copy from Workshop",
  });
  await waitFor(() => expect(button).toBeEnabled());
  expect(mods).not.toHaveBeenCalled();
  await userEvent.click(button);
  expect(mods).toHaveBeenCalledTimes(1);
  expect(mods).toHaveBeenCalledWith({ kind: "subscribe", id: "777" });
  expect(screen.getByRole("button", { name: "Subscribing…" })).toBeDisabled();
  await act(async () =>
    finish({ entries: [], message: "Subscribed explicitly." }),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Subscribed explicitly.",
  );
  expect(
    screen.getByRole("button", { name: "Keep a copy from Workshop" }),
  ).toBeEnabled();
});

test("offline guests can still inspect the scenario but subscription explains its unavailable state", async () => {
  const mods = desktop(false);
  render(<KeepModCopy scenario={scenario()} />);
  expect(
    screen.getByRole("button", { name: "Keep a copy from Workshop" }),
  ).toBeDisabled();
  expect(screen.getByText("Connect to Steam to keep a copy.")).toBeVisible();
  await act(async () => {
    await desktopStateReady;
  });
  expect(mods).not.toHaveBeenCalled();
});

test("a guest with no selection waits for the host without reading the local library", async () => {
  const mods = desktop();
  setup(coop(), true);
  expect(
    screen.getByText("Waiting for Ada to choose a community scenario…"),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "I'm ready" })).toBeNull();
  await act(async () => {
    await desktopStateReady;
  });
  expect(mods).not.toHaveBeenCalled();
  expect(screen.queryByRole("region", { name: "Installed Mods" })).toBeNull();
});
