import * as React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Dialog, TextField } from "@mui/material";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { TextEncoder } from "util";
import Mods, { modifierSummary } from "./Mods";
import {
  MOD_API_VERSION,
  ModPackage,
  packageDigest,
} from "../../mods/ModSchema";
import type { InstalledMod, ModLibrary, ModRequest } from "../../mods/Types";
import type { DesktopBridge } from "../../Desktop";
import { launchCustomScenario } from "../../reducers/Game";
import uiReducer from "../../reducers/UI";
import { buildModAuthorReport } from "../../mods/ModAuthoring";
import { loadSimData } from "../../testing/SimData";

Object.assign(global, { TextEncoder });
jest.mock("./StartGame", () => ({
  startWithSaveGuard: (_dispatch: unknown, start: () => void) => start(),
}));
jest.mock("../../reducers/Game", () => ({
  __esModule: true,
  ...jest.requireActual("../../reducers/Game"),
  launchCustomScenario: jest.fn(),
}));
jest.mock("../../mods/ModScenario", () => ({
  ...jest.requireActual("../../mods/ModScenario"),
  prepareModStartingPeak: jest.fn().mockResolvedValue(undefined),
}));

const pack = (patch: Partial<ModPackage> = {}): ModPackage => ({
  schemaVersion: 1,
  gameApi: MOD_API_VERSION,
  id: "community-grid",
  title: "Community Grid",
  creator: "Ada",
  version: "1.0.0",
  description: "A community grid with its own planning decisions.",

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
      ui: uiReducer,
      game: () => ({ difficulty: "VP" }),
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: {
          ignoredActions: ["ui/snackbarOpen"],
          ignoredPaths: ["ui.snackbar.action"],
        },
      }),
  });
  render(
    <Provider store={store}>
      <Mods />
    </Provider>,
  );
  return { requests, mods, store };
}

afterEach(() => {
  delete window.electrifyDesktop;
  jest.clearAllMocks();
});

test.each(["idle", "menu", "dialog"] as const)(
  "returning from Mods respects the %s destination when its transition settles",
  async (destination) => {
    jest.useFakeTimers();
    const menu = document.createElement("main");
    menu.innerHTML =
      "<button data-mods-trigger>Mods</button><button>Play with friends</button>";
    document.body.appendChild(menu);
    try {
      await act(async () => {
        setup([]);
      });
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      let selected = screen.getByRole("button", { name: "Mods" });
      expect(selected).toHaveFocus();
      act(() => jest.advanceTimersByTime(300));
      if (destination === "menu") {
        selected = screen.getByRole("button", { name: "Play with friends" });
        act(() => selected.focus());
      } else if (destination === "dialog") {
        render(
          <Dialog open aria-label="Play with friends">
            <TextField label="Invite code" />
          </Dialog>,
        );
        selected = screen.getByRole("textbox", { name: "Invite code" });
        act(() => selected.focus());
      }
      act(() => jest.advanceTimersByTime(50));
      expect(selected).toHaveFocus();
    } finally {
      menu.remove();
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  },
);

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

test("an empty library keeps installation actions together with Workshop first", async () => {
  setup([], undefined, true);
  const installed = await screen.findByRole("region", {
    name: "Installed Mods",
  });
  expect(
    await within(installed).findByText("Install your first mod below"),
  ).toBeVisible();
  await within(installed).findByRole("button", { name: "Check for updates" });
  const buttons = within(installed).getAllByRole("button");
  expect(buttons.map((button) => button.textContent)).toEqual([
    "Browse Workshop",
    "Import mod",
    "Check for updates",
  ]);
  expect(buttons[0]).toHaveClass("MuiButton-contained");
  expect(buttons[1]).toHaveClass("MuiButton-outlined");
  expect(screen.queryByText("Add by Workshop item ID")).toBeNull();
});

test("saving a template uses the shared toast without inserting a body message", async () => {
  const message = "Template saved. Edit it, then choose Import mod.";
  const { store } = setup([], (input, entries) => ({
    entries,
    ...(input.kind === "template" ? { message } : {}),
  }));
  await userEvent.click(
    screen.getByRole("button", { name: "Save authoring template" }),
  );
  await waitFor(() =>
    expect(store.getState().ui.snackbar).toMatchObject({ open: true, message }),
  );
  expect(screen.queryByText(message)).toBeNull();
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
      "gameApi must be 1. This package targets an unsupported game contract.",
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

test("removing asks first, toasts errors without closing the dialog, and focuses the next mod", async () => {
  let fail = true;
  const { store } = setup(
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
  await waitFor(() =>
    expect(store.getState().ui.snackbar.message).toBe(
      "The mod library is busy.",
    ),
  );
  expect(screen.getByText("The mod library is busy.")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeVisible();
  await userEvent.click(within(screen.getByRole("dialog")).getByText("Remove"));
  await waitFor(() =>
    expect(store.getState().ui.snackbar.message).toBe(
      "Removed Community Grid.",
    ),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Play Second Grid")).toHaveFocus(),
  );
});

test.each([false, true])(
  "removing the last mod focuses an available install action when Steam online is %s",
  async (online) => {
    setup(
      [local()],
      (input, entries) => ({ entries: input.kind === "remove" ? [] : entries }),
      online,
    );
    await userEvent.click(
      await screen.findByLabelText("Remove Community Grid"),
    );
    await userEvent.click(
      within(screen.getByRole("dialog")).getByText("Remove"),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: online ? "Browse Workshop" : "Import mod",
        }),
      ).toHaveFocus(),
    );
  },
);

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

test("the launch details separate author claims from computed rules before starting", async () => {
  setup([local({ description: "Prepare your grid for a changing market." })]);
  await userEvent.click(await screen.findByLabelText("Play Community Grid"));
  const dialog = screen.getByRole("dialog", { name: "Play Community Grid" });
  expect(
    within(dialog).getByRole("region", { name: "Author description" }),
  ).toHaveTextContent("Prepare your grid for a changing market.");
  expect(
    within(dialog).getByRole("region", { name: "Scenario objectives" }),
  ).toHaveTextContent(/No scenario goals|No objectives/);
  expect(
    within(dialog).getByRole("button", { name: /Starting fleet/ }),
  ).toBeEnabled();
  expect(launchCustomScenario).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(launchCustomScenario).not.toHaveBeenCalled();
});

test("an author explicitly opens the complete validation report without launching", async () => {
  setup([local()]);
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Author validation report for Community Grid",
    }),
  );
  const dialog = screen.getByRole("dialog", {
    name: "Author validation report: Community Grid",
  });
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "Validation passed. Includes hidden events.",
  );
  expect(
    within(dialog).getByRole("region", { name: "Scenario diagnostics" }),
  ).toBeVisible();
  expect(launchCustomScenario).not.toHaveBeenCalled();
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Close report" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("the author can inspect every difficulty's complete resolved report", async () => {
  await loadSimData("SF");
  const entry = local({
    officialArcs: [],
    scenario: {
      durationMonths: 6,
      startingYear: 2020,
      startingCustomers: 10000,
    },
    events: [
      {
        id: "difficulty-support",
        title: "Difficulty support",
        message: "Fuel conditions change.",
        preview: "Fuel conditions will change.",
        startMonth: 1,
        durationMonths: {
          byDifficulty: { Intern: 1, Employee: 2, Manager: 3, VP: 4, CEO: 5 },
        },
        effects: {
          fuelPriceMultipliers: {
            "Natural Gas": {
              byDifficulty: {
                Intern: 0.8,
                Employee: 0.9,
                Manager: 1,
                VP: 1.1,
                CEO: 1.2,
              },
            },
          },
        },
      },
    ],
  });
  const expected = buildModAuthorReport(entry.pack);
  expect(
    expected.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error",
    ),
  ).toEqual([]);
  const expertSetup = expected.difficulties.CEO!.sections.find(
    (section) => section.id === "setup",
  )!;
  const expertPeak = expertSetup.rows.find(
    (row) => row.label === "Starting peak demand",
  )!.value;
  expect(expertPeak).toMatch(/^[1-9].* MW$/);
  const expertTimeline = expected.difficulties.CEO!.sections.find(
    (section) => section.id === "timeline",
  )!;
  expect(expertTimeline.rows).not.toEqual(
    expected.difficulties.Employee!.sections.find(
      (section) => section.id === "timeline",
    )!.rows,
  );
  setup([entry]);
  await userEvent.click(
    await screen.findByLabelText("Author validation report for Community Grid"),
  );
  const dialog = screen.getByRole("dialog", {
    name: "Author validation report: Community Grid",
  });
  // Direct labels/text avoid repeating JSDOM's style-heavy accessible-name scan
  // across every accordion; keep the full report interactions and visibility checks.
  expect(
    within(dialog).getByText("Easy", { selector: "button" }),
  ).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(
    within(dialog).getByText("Expert", { selector: "button" }),
  );
  await userEvent.click(within(dialog).getByText("Resolved setup"));
  expect(within(dialog).getByLabelText("Resolved setup")).toBeVisible();
  expect(within(dialog).getByLabelText("Resolved setup")).toHaveTextContent(
    expertPeak,
  );
  expect(within(dialog).getByLabelText("Resolved setup")).toHaveTextContent(
    expertSetup.rows.find((row) => row.label === "Difficulty")!.value,
  );
  await userEvent.click(within(dialog).getByText(expertTimeline.title));
  const timeline = within(dialog).getByLabelText(expertTimeline.title);
  expect(timeline).toBeVisible();
  expect(timeline).toHaveTextContent("Active for 5 months");
  expect(timeline).toHaveTextContent("Natural Gas fuel price: 120% of normal");
  await userEvent.click(
    within(dialog).getByText("Beginner", { selector: "button" }),
  );
  expect(timeline).toHaveTextContent("Active for 1 month");
  expect(timeline).toHaveTextContent("Natural Gas fuel price: 80% of normal");
  expect(timeline).not.toHaveTextContent("120% of normal");
  expect(
    within(dialog).queryByRole("button", {
      name: "Inherited objectives: replace-ready JSON",
    }),
  ).toBeNull();
  await userEvent.click(within(dialog).getByText("Difficulty validation"));
  expect(
    within(dialog).getByLabelText("Difficulty validation"),
  ).toHaveTextContent("CEO");
  expect(
    within(dialog).getByLabelText("Scenario diagnostics"),
  ).toHaveTextContent("scenario.durationMonths");
  expect(launchCustomScenario).not.toHaveBeenCalled();
  await userEvent.click(
    within(dialog).getByText("Close report", { selector: "button" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await userEvent.click(
    screen.getByRole("button", { name: "Play Community Grid" }),
  );
  const playDialog = screen.getByRole("dialog", {
    name: "Play Community Grid",
  });
  expect(
    within(playDialog).getByRole("button", { name: "Hard" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(launchCustomScenario).not.toHaveBeenCalled();
});

test("private event warnings remain available only in the explicit author report", async () => {
  setup([
    local({
      officialArcs: [],
      scenario: { durationMonths: 6 },
      events: [
        {
          id: "private-transformer",
          title: "Surprise transformer failure",
          message: "A transformer fails.",
          visibility: "surprise",
          startMonth: 5,
          durationMonths: 3,
          effects: { outputMultipliersByFuel: { "Natural Gas": 0.8 } },
        },
      ],
    }),
  ]);
  const play = await screen.findByRole("button", {
    name: "Play Community Grid",
  });
  expect(
    screen.queryAllByText(/private-transformer|Surprise transformer failure/),
  ).toHaveLength(0);
  await userEvent.click(play);
  const dialog = screen.getByRole("dialog", { name: "Play Community Grid" });
  expect(
    within(dialog).queryAllByText(
      /private-transformer|Surprise transformer failure/,
    ),
  ).toHaveLength(0);
  await userEvent.click(
    within(dialog).getByText("Cancel", { selector: "button" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await userEvent.click(
    screen.getByLabelText("Author validation report for Community Grid"),
  );
  expect(screen.getByLabelText("Scenario diagnostics")).toHaveTextContent(
    "Surprise transformer failure may continue beyond the term",
  );
  expect(screen.getByLabelText("Scenario diagnostics")).toHaveTextContent(
    "events.private-transformer.durationMonths",
  );
});

test("publishing stays open while uploading and offers the Steam page afterwards", async () => {
  let finish: (value: ModLibrary) => void = () => {};
  const { requests, store } = setup(
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
  expect(requests).toContainEqual(
    expect.objectContaining({
      kind: "publish",
      key: "local:community-grid",
      packageDigest: packageDigest(pack()),
      rulesDescription: expect.stringContaining("Rules"),
    }),
  );
  await userEvent.click(screen.getByText("Close"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await userEvent.click(
    screen.getByRole("button", { name: "Browse Workshop" }),
  );
  expect(requests).toContainEqual({ kind: "browse" });
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () =>
    finish({
      entries: [{ ...local(), workshopId: "456" }],
      message:
        "Uploaded, but hidden until you accept the Steam Workshop agreement.",
      published: { workshopId: "456", agreement: true },
    }),
  );
  expect(store.getState().ui.snackbar).toMatchObject({
    open: true,
    message:
      "Uploaded, but hidden until you accept the Steam Workshop agreement.",
    actionLabel: "Open on Steam",
  });
  act(() =>
    store.getState().ui.snackbar.action?.({} as React.MouseEvent<HTMLElement>),
  );
  await waitFor(() =>
    expect(requests).toContainEqual({ kind: "browse", workshopId: "456" }),
  );
  expect(
    screen.getByText("Update Community Grid on Workshop"),
  ).toBeInTheDocument();
});

test("opening with Steam running refreshes downloads quietly", async () => {
  const { requests, store } = setup(
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
  expect(
    screen.getByText(
      "Skipped Workshop item 123: not a data-only scenario package.",
    ),
  ).toBeVisible();
  expect(store.getState().ui.snackbar.open).toBe(false);
  await userEvent.click(screen.getByText("Browse Workshop"));
  expect(requests).toContainEqual({ kind: "browse" });
});

test("an unreadable library can be reset from the screen", async () => {
  const { requests, store } = setup([], (input) =>
    input.kind === "reset"
      ? { entries: [], message: "Mod library reset." }
      : {
          entries: [],
          unreadable: true,
          error: "Your mod library couldn't be read.",
        },
  );
  await waitFor(() =>
    expect(store.getState().ui.snackbar).toMatchObject({
      open: true,
      message: "Your mod library couldn't be read.",
      actionLabel: "Reset mod library",
    }),
  );
  act(() =>
    store.getState().ui.snackbar.action?.({} as React.MouseEvent<HTMLElement>),
  );
  await waitFor(() =>
    expect(store.getState().ui.snackbar.message).toBe("Mod library reset."),
  );
  expect(requests.map((r) => r.kind)).toEqual(["list", "reset"]);
});

test("a rejected IPC keeps the installed library visible and offers persistent Retry", async () => {
  let fail = true;
  const { store } = setup([local()], (input, entries) => {
    if (input.kind === "template" && fail) {
      fail = false;
      throw new Error("IPC disconnected");
    }
    return { entries };
  });
  await screen.findByText("Community Grid");
  await userEvent.click(screen.getByText("Save authoring template"));
  expect(screen.getByText("Community Grid")).toBeVisible();
  expect(screen.queryByText("Install your first mod below")).toBeNull();
  expect(
    screen.getByText(
      "Mods couldn't be loaded. Check the connection and Retry.",
    ),
  ).toBeVisible();
  act(() => {
    store.dispatch({ type: "ui/snackbarOpen", payload: { open: false } });
  });
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(
      screen.queryByText(
        "Mods couldn't be loaded. Check the connection and Retry.",
      ),
    ).toBeNull(),
  );
});

test("a staged import shows both identities and requires an explicit replacement choice", async () => {
  const { requests } = setup([local()], (input, entries) => ({
    entries,
    ...(input.kind === "import"
      ? {
          importConflict: {
            token: "preview",
            existing: pack(),
            incoming: pack({
              title: "Other grid",
              creator: "Bo",
              version: "9",
            }),
          },
        }
      : {}),
  }));
  await screen.findByText("Community Grid");
  await userEvent.click(screen.getByText("Import mod"));
  const dialog = await screen.findByRole("dialog");
  expect(
    within(dialog).getByText("Community Grid · by Ada · v1.0.0"),
  ).toBeVisible();
  expect(within(dialog).getByText("Other grid · by Bo · v9")).toBeVisible();
  await userEvent.click(within(dialog).getByText("Install as copy"));
  expect(requests).toContainEqual({
    kind: "resolveImport",
    token: "preview",
    action: "copy",
  });
});

test("a stale browse response cannot undo a completed upload", async () => {
  let finishUpload: (value: ModLibrary) => void = () => {};
  let finishBrowse: (value: ModLibrary) => void = () => {};
  setup(
    [local()],
    (input, entries) => {
      if (input.kind === "publish")
        return new Promise((resolve) => {
          finishUpload = resolve;
        });
      if (input.kind === "browse")
        return new Promise((resolve) => {
          finishBrowse = resolve;
        });
      return { entries };
    },
    true,
  );
  await userEvent.click(await screen.findByText("Publish Community Grid"));
  await userEvent.click(screen.getByText("Publish publicly"));
  await userEvent.click(screen.getByText("Close"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await userEvent.click(screen.getByText("Browse Workshop"));
  await act(async () =>
    finishUpload({ entries: [{ ...local(), workshopId: "456" }] }),
  );
  expect(screen.getByText("Update Community Grid on Workshop")).toBeVisible();
  await act(async () => finishBrowse({ entries: [local()] }));
  expect(screen.getByText("Update Community Grid on Workshop")).toBeVisible();
});

test("unrelated imports and browsing do not dismiss unresolved Workshop actions or download status", async () => {
  const { requests } = setup(
    [local()],
    (input, entries) => {
      if (input.kind === "refresh")
        return {
          entries,
          warning: "Skipped Workshop item 123: truncated download.",
          downloads: [{ id: "777", status: "queued" }],
        };
      if (input.kind === "import")
        return { entries, error: "The imported file has an invalid title." };
      return { entries };
    },
    true,
  );
  expect(
    await screen.findByText("Skipped Workshop item 123: truncated download."),
  ).toBeVisible();
  await userEvent.click(screen.getByText("Import mod"));
  expect(
    screen.getByText("The imported file has an invalid title."),
  ).toBeVisible();
  expect(
    screen.getByText("Skipped Workshop item 123: truncated download."),
  ).toBeVisible();
  await userEvent.click(screen.getByText("Browse Workshop"));
  expect(requests).toContainEqual({ kind: "browse" });
  expect(screen.getByText("Workshop item 777: Queued")).toBeVisible();
  expect(
    screen.getByText("Skipped Workshop item 123: truncated download."),
  ).toBeVisible();
});
