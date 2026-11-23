import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { randomUUID } from "node:crypto";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import type { AudioNode } from "../audio/AudioNode";
import { MUSIC_INTRO_FILE, ThemeManager } from "../audio/ThemeManager";
import { MUSIC_DEFINITIONS } from "../Constants";
import { state as audio } from "../data/Audio";
import { getDesktop } from "../Desktop";
import type { DesktopInputFrame } from "../Desktop";
import { getAudioContext } from "../AudioContext";
import AudioContainer from "../components/base/AudioContainer";
import { coopControls } from "../multiplayer/Registry";
import { createMultiplayerWorker } from "../multiplayer/WorkerClient";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../multiplayer/WorkerProtocol";
import { createWorld, roomView } from "../multiplayer/World";
import { store } from "../Store";
import { COOP_TEST_SPEC } from "../testing/MultiplayerFixtures";
import { loadSimData } from "../testing/SimData";
import { couchPlatformActive, couchPlatformMatch } from "./Platform";
import CouchRoot from "./Root";

jest.mock("../AudioContext", () => ({
  ...jest.requireActual("../AudioContext"),
  getAudioContext: jest.fn(),
}));
jest.mock("../Desktop", () => ({
  ...jest.requireActual("../Desktop"),
  getDesktop: jest.fn(),
  isDesktopApp: () => true,
}));
jest.mock("../multiplayer/WorkerClient", () => ({
  createMultiplayerWorker: jest.fn(),
}));
jest.mock("../desktop/InputHints", () => ({ ControlsLegend: () => null }));
jest.mock("../components/views/SettingsContainer", () => () => null);
jest.mock("../components/views/ManualContainer", () => () => null);

type Device = DesktopInputFrame & { id: string };
let emit: (event: unknown) => void;
let bindings: Record<string, string>;
let nativeDevices: Device[];
let setupReply: Promise<unknown>;
const request = jest.fn();

const device = (id: string, connected = true): Device => ({
  id,
  connected,
  actions: [],
  glyphs: {},
});

beforeEach(() => {
  bindings = {};
  nativeDevices = [device("101"), device("202")];
  setupReply = Promise.resolve({ available: true, devices: [] });
  request.mockReset();
  request.mockImplementation(async (input: Record<string, unknown>) => {
    switch (input.kind) {
      case "setup":
        return setupReply;
      case "list-saves":
        return { slots: [] };
      case "bind":
        bindings[String(input.seatId)] = String(input.controllerId);
        return;
      case "status":
        return { bindings: { ...bindings }, devices: nativeDevices };
      default:
        return;
    }
  });
  (getDesktop as jest.Mock).mockReturnValue({
    couchRequest: request,
    onGameFocusChanged: () => () => {},
    onCouchEvent: (listener: typeof emit) => {
      emit = listener;
      return () => {};
    },
  });
});

async function mount(audio?: ReactNode) {
  const view = render(
    <Provider store={store}>
      <CouchRoot onClose={() => {}} />
      {audio}
    </Provider>,
  );
  await act(async () => {
    await setupReply;
  });
  return view;
}

it("accepts binding acknowledgments against the newest device frame before React commits", async () => {
  await mount();
  await act(async () => {
    emit({
      kind: "devices",
      devices: nativeDevices.map((item) => ({ ...item, actions: ["confirm"] })),
    });
    // Immediate native replies settle in this batch, before the device-state render.
    for (let index = 0; index < 4; index++) await Promise.resolve();
  });
  expect(
    screen.getAllByText("Controller joined", { exact: true }),
  ).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Choose a game" })).toBeEnabled();
});

it("rejects a binding when a newer disconnect arrives before its acknowledgment", async () => {
  let acknowledge!: () => void;
  const nativeRequest = request.getMockImplementation()!;
  request.mockImplementation((input: Record<string, unknown>) =>
    input.kind === "bind"
      ? new Promise<void>((resolve) => {
          bindings[String(input.seatId)] = String(input.controllerId);
          acknowledge = resolve;
        })
      : nativeRequest(input),
  );
  await mount();
  await act(async () => {
    emit({
      kind: "devices",
      devices: [{ ...device("101"), actions: ["confirm"] }],
    });
  });
  await act(async () => {
    // Status still reports the connected device; the newer input frame must win.
    emit({ kind: "devices", devices: [device("101", false)] });
    acknowledge();
    for (let index = 0; index < 4; index++) await Promise.resolve();
  });
  expect(
    screen.queryByText("Controller joined", { exact: true }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "controller assignment could not be confirmed",
  );
  expect(screen.getByRole("button", { name: "Choose a game" })).toBeDisabled();
});

/** Publish through the real coordinator, with the worker transport under test control. */
function mockCouchWorker() {
  const worker = {
    onmessage: null as ((event: MessageEvent<WorkerResponse>) => void) | null,
    terminate: jest.fn(),
    postMessage(message: WorkerRequest) {
      if (message.kind !== "create") return;
      const { spec, seats, matchId, epoch } = message;
      const world = createWorld(spec, seats, matchId, epoch);
      const view = roomView(world, seats[0].id);
      const receive = worker.onmessage!;
      const publish = (data: WorkerResponse) =>
        receive(new MessageEvent("message", { data }));
      // Keep the old transport callback to simulate a delivery already in flight during cleanup.
      replayView = () =>
        publish({ kind: "views", views: { [seats[0].id]: view } });
      replayView();
      publish({
        kind: "summary",
        summary: {
          matchId,
          epoch,
          date: view.game!.date,
          revision: view.revision,
          speed: view.speed,
          reason: view.reason,
          ready: view.ready,
          readyRequired: view.readyRequired,
          systemBlockers: [],
          players: seats.map((seat) => ({
            ...seat,
            selectedSpeed: "PAUSED",
            retired: false,
          })),
          complete: false,
          outcomes: {},
        },
      });
    },
  };
  let replayView: () => void;
  return { worker, replay: () => replayView() };
}

async function confirmLocalGame() {
  const confirm = () =>
    emit({
      kind: "devices",
      devices: nativeDevices.map((item) => ({ ...item, actions: ["confirm"] })),
    });
  await act(async () => confirm());
  fireEvent.click(screen.getByRole("button", { name: "Choose a game" }));
  act(() => coopControls()!.start(COOP_TEST_SPEC));
  await act(async () => confirm());
}

it.each(["open", "layout"])(
  "restarts the opening music after native %s fails without reviving the old session",
  async (operation) => {
    await loadSimData("SF");
    const first = mockCouchWorker();
    const retry = mockCouchWorker();
    jest
      .mocked(createMultiplayerWorker)
      .mockReturnValueOnce(first.worker as unknown as Worker)
      .mockReturnValueOnce(retry.worker as unknown as Worker);

    const context = { currentTime: 0, state: "running" } as AudioContext;
    jest.mocked(getAudioContext).mockReturnValue(context);
    const visibility = jest
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    const originalCrypto = Object.getOwnPropertyDescriptor(window, "crypto");
    Object.defineProperty(window, "crypto", {
      configurable: true,
      value: { randomUUID },
    });
    const node = (duration: number) => ({
      duration,
      play: jest.fn(),
      fadeOut: jest.fn(),
      fadeTo: jest.fn(),
      stopAll: jest.fn(),
    });
    const intro = node(29.3);
    const nodes = Object.fromEntries([
      ...Object.values(MUSIC_DEFINITIONS).flatMap(({ directory, tracks }) =>
        tracks.map((track) => [directory + track, node(400)]),
      ),
      [MUSIC_INTRO_FILE, intro],
    ]);
    const previousAudio = { ...audio };
    Object.assign(audio, {
      loaded: "LOADED",
      paused: false,
      themeManager: new ThemeManager(
        context,
        nodes as unknown as Record<string, AudioNode>,
      ),
    });

    let failStartup!: (error: Error) => void;
    const pending = new Promise<never>((_, reject) => {
      failStartup = reject;
    });
    let startupCalled = false;
    const nativeRequest = request.getMockImplementation()!;
    request.mockImplementation((input: Record<string, unknown>) => {
      if (input.kind === "close") bindings = {};
      if (input.kind !== operation || startupCalled)
        return nativeRequest(input);
      startupCalled = true;
      return pending;
    });

    const view = await mount(<AudioContainer />);
    try {
      await confirmLocalGame();
      await waitFor(() => expect(startupCalled).toBe(true));
      const failedToken = couchPlatformMatch()!.token;
      expect(audio.musicRunId).toBe(`couch:${failedToken}`);
      expect(intro.play).toHaveBeenCalledTimes(1);
      expect(intro.play.mock.calls[0][1]).toBe(0);

      await act(async () => failStartup(new Error("Native TV startup failed")));
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Native TV startup failed",
      );
      expect(first.worker.terminate).toHaveBeenCalledTimes(1);
      act(() => first.replay());
      const failedProjection = couchPlatformMatch();
      const failedMusic = audio.musicRunId;

      await confirmLocalGame();
      await waitFor(() =>
        expect(
          request.mock.calls.filter(([input]) => input.kind === operation),
        ).toHaveLength(2),
      );
      const retryProjection = couchPlatformMatch()!;
      const retryToken = retryProjection.token;
      expect(retryToken).not.toBe(failedToken);
      expect(failedProjection).toBeUndefined();
      expect(failedMusic).toBeUndefined();
      expect(audio.musicRunId).toBe(`couch:${retryToken}`);
      expect(intro.fadeOut).toHaveBeenCalledTimes(1);
      expect(intro.play).toHaveBeenCalledTimes(2);
      expect(intro.play.mock.calls[1][1]).toBe(0);

      act(() => first.replay());
      expect(couchPlatformMatch()).toBe(retryProjection);
      expect(audio.musicRunId).toBe(`couch:${retryToken}`);
      expect(intro.play).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
      Object.assign(audio, previousAudio);
      visibility.mockRestore();
      if (originalCrypto)
        Object.defineProperty(window, "crypto", originalCrypto);
      else Reflect.deleteProperty(window, "crypto");
      jest.mocked(getAudioContext).mockReset();
    }
    expect(retry.worker.terminate).toHaveBeenCalledTimes(1);
    expect(couchPlatformActive()).toBe(false);
  },
);
