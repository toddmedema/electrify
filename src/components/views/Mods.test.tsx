import * as React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { TextEncoder } from "util";
import Mods, { modifierSummary } from "./Mods";
import { MOD_API_VERSION, ModPackage } from "../../mods/ModSchema";
import type { InstalledMod, ModLibrary, ModRequest } from "../../mods/Types";
import type { DesktopBridge } from "../../Desktop";
import { launchCustomScenario } from "../../reducers/Game";

Object.assign(global, { TextEncoder });
jest.mock("./StartGame", () => ({
  startWithSaveGuard: (_dispatch: unknown, start: () => void) => start(),
}));
jest.mock("../../reducers/Game", () => ({
  launchCustomScenario: jest.fn(),
}));

const pack = (patch: Partial<ModPackage> = {}): ModPackage => ({
  schemaVersion: 1,
  gameApi: MOD_API_VERSION,
  id: "community-grid",
  title: "Community Grid",
  creator: "Ada",
  version: "1.0.0",
  seed: 42,
  baseScenarioId: 999,
  ...patch,
});
const local = (patch: Partial<ModPackage> = {}): InstalledMod => {
  const p = pack(patch);
  return { key: `local:${p.id}`, source: "local", enabled: true, pack: p };
};
const workshop: InstalledMod = {
  key: "workshop:777",
  source: "workshop",
  workshopId: "777",
  enabled: true,
  pack: pack({ id: "shared-grid", title: "Shared Grid", creator: "Bo" }),
};

function setup(
  initial: InstalledMod[],
  respond: (
    input: ModRequest,
    entries: InstalledMod[],
  ) => ModLibrary | Promise<ModLibrary> = (_input, entries) => ({ entries }),
  steamOnline = false,
) {
  let entries = initial;
  const requests: ModRequest[] = [];
  const mods = jest.fn(async (input: ModRequest) => {
    requests.push(input);
    const result = await respond(input, entries);
    entries = result.entries;
    return result;
  });
  const state = {
    display: { fullscreen: false, width: 1, height: 1, resolutions: [] },
    steam: { available: true, online: steamOnline, cloudEnabled: false },
  };
  window.electrifyDesktop = {
    apiVersion: 1,
    mods,
    getState: async () => state,
    onStateChanged: () => () => {},
  } as unknown as DesktopBridge;
  const store = configureStore({
    reducer: {
      ui: () => ({ coop: undefined, previewDifficulty: undefined }),
      game: () => ({ difficulty: "VP" }),
    },
  });
  render(
    <Provider store={store}>
      <Mods />
    </Provider>,
  );
  return { requests, mods };
}

afterEach(() => {
  delete window.electrifyDesktop;
  jest.clearAllMocks();
});

test("modifiers read as player-facing changes with program names", () => {
  expect(
    modifierSummary(
      pack({
        facilities: { Solar: { buildCost: 0.8, yearsToBuild: 1.5 } },
        programs: { efficiency: 0.5 },
      }),
    ),
  ).toBe(
    "Solar build cost −20% · Solar build time +50% · Efficiency rebates cost −50%",
  );
});

test("entries show creator, version and source, and incompatible mods explain why", async () => {
  setup([
    local(),
    local({ id: "old", title: "Old Grid", gameApi: 2 }),
    workshop,
  ]);
  expect(await screen.findByText("Community Grid")).toBeInTheDocument();
  expect(screen.getAllByText("by Ada · v1.0.0 · Local file")).toHaveLength(2);
  expect(screen.getByText("by Bo · v1.0.0 · Workshop")).toBeInTheDocument();
  expect(
    screen.getByText(
      "Made for a different game version. Ask Ada for an update.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Play Old Grid")).toBeNull();
  expect(screen.queryByText(/rules-|Seed/)).toBeNull();
  // Steam is offline: Workshop controls explain why they are unavailable.
  expect(
    screen.getByText("Workshop needs Steam. Local mods still work offline."),
  ).toBeInTheDocument();
  expect(screen.getByText("Browse Workshop")).toBeDisabled();
  expect(screen.queryByLabelText("Unsubscribe from Shared Grid")).toBeNull();
  expect(
    screen.getByText(
      "Connect to Steam to unsubscribe. You can disable it now.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Shared Grid enabled")).toBeEnabled();
});

test("removing asks first, keeps errors in the dialog, and moves focus to the next mod", async () => {
  let fail = true;
  setup(
    [local(), local({ id: "second", title: "Second Grid" })],
    (input, entries) => {
      if (input.kind !== "remove") return { entries };
      if (fail) {
        fail = false;
        return { entries, error: "The mod library is busy." };
      }
      return {
        entries: entries.filter((e) => e.key !== input.key),
        message: "Removed Community Grid.",
      };
    },
  );
  await userEvent.click(await screen.findByLabelText("Remove Community Grid"));
  expect(
    await screen.findByText("Remove “Community Grid”?"),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      "Existing saves keep working. Import the file again to reinstall.",
    ),
  ).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText("Cancel")).toHaveFocus());
  await userEvent.click(within(screen.getByRole("dialog")).getByText("Remove"));
  expect(
    await screen.findByText("The mod library is busy."),
  ).toBeInTheDocument();
  await userEvent.click(within(screen.getByRole("dialog")).getByText("Remove"));
  expect(
    await screen.findByText("Removed Community Grid."),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByLabelText("Play Second Grid")).toHaveFocus(),
  );
});

test("Play asks for a difficulty and launches through the shared custom launcher", async () => {
  setup([local()]);
  await userEvent.click(await screen.findByLabelText("Play Community Grid"));
  expect(await screen.findByText("Play Community Grid")).toBeInTheDocument();
  await userEvent.click(screen.getByText("Start"));
  expect(launchCustomScenario).toHaveBeenCalledWith(
    expect.any(Function),
    expect.objectContaining({
      id: 999,
      name: "Community Grid",
      mod: expect.objectContaining({
        source: expect.objectContaining({ id: "community-grid" }),
      }),
    }),
    "VP",
  );
});

test("publishing stays open while uploading and offers the Steam page afterwards", async () => {
  let finish: (value: ModLibrary) => void = () => {};
  const { requests } = setup(
    [local()],
    (input, entries) => {
      if (input.kind === "publish")
        return new Promise<ModLibrary>((resolve) => {
          finish = resolve;
        });
      return { entries };
    },
    true,
  );
  await userEvent.click(await screen.findByText("Publish Community Grid"));
  expect(
    await screen.findByText("Publish “Community Grid” to Workshop?"),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByText("Publish publicly"));
  expect(await screen.findByText("Uploading…")).toBeInTheDocument();
  await userEvent.click(screen.getByText("Cancel"));
  expect(screen.getByText("Uploading…")).toBeInTheDocument();
  await act(async () =>
    finish({
      entries: [{ ...local(), workshopId: "456" }],
      message:
        "Uploaded, but hidden until you accept the Steam Workshop agreement.",
      published: { workshopId: "456", agreement: true },
    }),
  );
  expect(
    await screen.findByText(
      "Uploaded, but hidden until you accept the Steam Workshop agreement.",
    ),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByText("Open on Steam"));
  await waitFor(() =>
    expect(requests).toContainEqual({ kind: "browse", workshopId: "456" }),
  );
  expect(
    screen.getByText("Update Community Grid on Workshop"),
  ).toBeInTheDocument();
});

test("opening with Steam running refreshes downloads quietly", async () => {
  const { requests } = setup(
    [],
    (input, entries) =>
      input.kind === "refresh"
        ? {
            entries: [workshop],
            message: "Installed 1 mod.",
            warning:
              "Skipped Workshop item 123: not a data-only scenario package.",
          }
        : { entries },
    true,
  );
  expect(await screen.findByText("Shared Grid")).toBeInTheDocument();
  expect(requests.map((r) => r.kind)).toEqual(["list", "refresh"]);
  expect(screen.getByText("Installed 1 mod.")).toBeInTheDocument();
  expect(
    screen.getByText(
      "Skipped Workshop item 123: not a data-only scenario package.",
    ),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByText("Browse Workshop"));
  expect(requests).toContainEqual({ kind: "browse" });
});

test("an unreadable library can be reset from the screen", async () => {
  const { requests } = setup([], (input) =>
    input.kind === "reset"
      ? { entries: [], message: "Mod library reset." }
      : {
          entries: [],
          unreadable: true,
          error: "Your mod library couldn't be read.",
        },
  );
  expect(
    await screen.findByText("Your mod library couldn't be read."),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByText("Reset mod library"));
  expect(await screen.findByText("Mod library reset.")).toBeInTheDocument();
  expect(requests.map((r) => r.kind)).toEqual(["list", "reset"]);
});
