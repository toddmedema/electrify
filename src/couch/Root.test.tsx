import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { getDesktop } from "../Desktop";
import type { DesktopInputFrame } from "../Desktop";
import { store } from "../Store";
import CouchRoot from "./Root";

jest.mock("../Desktop", () => ({
  ...jest.requireActual("../Desktop"),
  getDesktop: jest.fn(),
}));
jest.mock("./Platform", () => ({
  ...jest.requireActual("./Platform"),
  beginCouchPlatform: () => ({ dispose: () => {} }),
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
    onCouchEvent: (listener: typeof emit) => {
      emit = listener;
      return () => {};
    },
  });
});

async function mount() {
  render(
    <Provider store={store}>
      <CouchRoot onClose={() => {}} />
    </Provider>,
  );
  await act(async () => {
    await setupReply;
  });
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
