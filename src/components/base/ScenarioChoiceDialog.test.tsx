import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { GameType, ScenarioChoiceType } from "../../Types";
import ScenarioChoiceDialog from "./ScenarioChoiceDialog";

const mockDispatch = jest.fn();
const theme = createTheme({
  components: { MuiButtonBase: { defaultProps: { disableRipple: true } } },
});
function renderDialog() {
  return render(
    <ThemeProvider theme={theme}>
      <ScenarioChoiceDialog />
    </ThemeProvider>,
  );
}
let mockCash = 15000000;
let mockDecision: ScenarioChoiceType;
let mockMultiplayer: GameType["multiplayer"];
jest.mock("../../Store", () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: () => ({
    inGame: true,
    difficulty: "CEO",
    date: {},
    multiplayer: mockMultiplayer,
  }),
}));
jest.mock("../../helpers/ScenarioChoices", () => ({
  ...jest.requireActual("../../helpers/ScenarioChoices"),
  pendingScenarioChoice: () => mockDecision,
}));
jest.mock("../../helpers/DateTime", () => ({
  getTimeFromTimeline: () => ({ cash: mockCash }),
}));

beforeEach(() => {
  mockDispatch.mockClear();
  mockCash = 15000000;
  mockMultiplayer = undefined;
  mockDecision = {
    id: "connection",
    scenarioId: 106,
    atMonth: 48,
    title: "Choose a connection schedule",
    message: "Choose when the new demand arrives.",
    options: [
      {
        id: "fast-track",
        label: "Accept funding",
        cost: () => 0,
        upfrontGrant: () => 10000000,
        description:
          "Receive {grant} in exchange for the full 100 MW coming online in January 2026.",
        message: "Funding accepted.",
      },
      {
        id: "phased",
        label: "Phase connections",
        cost: () => 0,
        description:
          "Forgo funding to connect 50 MW in 2026 and another 50 MW in 2028.",
        message: "Connections phased.",
      },
    ],
  };
});

test("explains funding and both binding schedules accessibly before a choice", () => {
  renderDialog();
  const funded = screen.getByRole("button", { name: "Accept funding" });
  expect(funded).toHaveAccessibleDescription(
    "Receive $10M in exchange for the full 100 MW coming online in January 2026. One-time grant: $10M",
  );
  expect(
    screen.getByRole("button", { name: "Phase connections" }),
  ).toHaveAccessibleDescription(
    "Forgo funding to connect 50 MW in 2026 and another 50 MW in 2028.",
  );
  fireEvent.click(funded);
  expect(mockDispatch).toHaveBeenCalledWith({
    type: "game/chooseScenarioResponse",
    payload: { decisionId: "connection", optionId: "fast-track" },
  });
});

test("an unaffordable paid option explains the shortfall and focuses the free response", async () => {
  mockCash = 1000000;
  mockDecision.options[0] = {
    id: "winterize",
    label: "Winterize plants",
    cost: () => 40000000,
    description: "Halve output losses while demand and gas prices still surge.",
    message: "Winterization funded.",
  };
  renderDialog();
  const paid = screen.getByRole("button", { name: "Winterize plants ($40M)" });
  expect(paid).toBeDisabled();
  expect(paid).toHaveAccessibleDescription(
    "Halve output losses while demand and gas prices still surge. · Insufficient cash",
  );
  expect(
    screen.getByRole("button", { name: "Phase connections" }),
  ).toBeEnabled();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Phase connections" }),
    ).toHaveFocus(),
  );
});

test("an eight-option choice keeps every consequence reachable and focuses its first affordable option", async () => {
  mockCash = 1000000;
  mockDecision.options = Array.from({ length: 8 }, (_, index) => ({
    id: `option-${index}`,
    label: `Response ${index + 1}`,
    description: `Consequence ${index + 1}.`,
    message: `Result ${index + 1}.`,
    cost: () => (index < 3 ? 2000000 : 0),
  }));
  renderDialog();
  expect(screen.getAllByRole("button")).toHaveLength(8);
  const first = screen.getByRole("button", { name: "Response 4" });
  await waitFor(() => expect(first).toHaveFocus());
  expect(
    screen.getByRole("button", { name: "Response 8" }),
  ).toHaveAccessibleDescription("Consequence 8.");
  fireEvent.click(first);
  expect(mockDispatch).toHaveBeenCalledWith({
    type: "game/chooseScenarioResponse",
    payload: { decisionId: "connection", optionId: "option-3" },
  });
});

test("computed funding is shown independently of an author's claim", () => {
  mockDecision.options[0].description =
    "The author claims a million dollars of support.";
  renderDialog();
  expect(
    screen.getByRole("button", { name: "Accept funding" }),
  ).toHaveAccessibleDescription(
    "The author claims a million dollars of support. One-time grant: $10M",
  );
});

test("a queued simultaneous decision receives focus even when its option IDs are reused", async () => {
  const view = renderDialog();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Accept funding" }),
    ).toHaveFocus(),
  );
  mockDecision = {
    ...mockDecision,
    id: "second-decision",
    title: "Choose the follow-up",
    options: [
      { ...mockDecision.options[1], label: "Follow-up response" },
      { ...mockDecision.options[0], label: "Alternative response" },
    ],
  };
  view.rerender(
    <ThemeProvider theme={theme}>
      <ScenarioChoiceDialog />
    </ThemeProvider>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Follow-up response" }),
    ).toHaveFocus(),
  );
  expect(
    screen.getByRole("dialog", { name: /Choose the follow-up/ }),
  ).toBeVisible();
});

test("a co-op choice names this company and every company still deciding without changing response scope", () => {
  mockMultiplayer = {
    seat: "grace",
    clock: {
      activeSpeed: "PAUSED",
      selectedSpeed: "NORMAL",
      reason: "Grace: Choosing a response · Hedy: Choosing a response",
      readyRequired: false,
      ready: false,
      players: [
        {
          id: "grace",
          name: "Grace",
          selectedSpeed: "NORMAL",
          pauseReason: "Choosing a response",
        },
        {
          id: "hedy",
          name: "Hedy",
          selectedSpeed: "NORMAL",
          pauseReason: "Choosing a response",
        },
        { id: "ada", name: "Ada", selectedSpeed: "NORMAL" },
      ],
    },
  };
  renderDialog();
  expect(screen.getByText("Your company: Grace")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Still deciding: Grace, Hedy. Each company chooses for its own grid.",
  );
  expect(screen.getByRole("status")).not.toHaveTextContent("Ada");
  fireEvent.click(screen.getByRole("button", { name: "Accept funding" }));
  expect(mockDispatch).toHaveBeenCalledWith({
    type: "game/chooseScenarioResponse",
    payload: { decisionId: "connection", optionId: "fast-track" },
  });
});

test("solo choices retain their own wording without co-op company context", () => {
  renderDialog();
  expect(screen.queryByText(/Your company:|Still deciding:/)).toBeNull();
  expect(screen.getByText("Choose when the new demand arrives.")).toBeVisible();
});
