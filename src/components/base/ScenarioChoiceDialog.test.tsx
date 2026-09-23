import { fireEvent, render, screen } from "@testing-library/react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { ScenarioChoiceType } from "../../Types";
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
jest.mock("../../Store", () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: () => ({ inGame: true, difficulty: "CEO", date: {} }),
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
    "Receive $10M in exchange for the full 100 MW coming online in January 2026.",
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

test("an unaffordable paid option explains the shortfall and leaves a free response", () => {
  mockCash = 1000000;
  mockDecision.options[0] = {
    id: "winterize",
    label: "Winterize plants",
    cost: () => 40000000,
    description:
      "Spend {cost} to halve output losses while demand and gas prices still surge.",
    message: "Winterization funded.",
  };
  renderDialog();
  const paid = screen.getByRole("button", { name: "Winterize plants" });
  expect(paid).toBeDisabled();
  expect(paid).toHaveAccessibleDescription(
    "Spend $40M to halve output losses while demand and gas prices still surge. · Insufficient cash",
  );
  expect(
    screen.getByRole("button", { name: "Phase connections" }),
  ).toBeEnabled();
});
