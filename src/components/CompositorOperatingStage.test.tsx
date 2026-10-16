import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { store } from "../Store";
import { isDesktopScreen } from "../Globals";
import Compositor, { Props } from "./Compositor";

const mockStageMounted = jest.fn();
const mockFleetMounted = jest.fn();
jest.mock("../Globals", () => ({
  ...jest.requireActual("../Globals"),
  isPaneLayout: () => true,
  isDesktopScreen: jest.fn(() => true),
}));
jest.mock("./base/OperatingStage", () => ({
  __esModule: true,
  default: function StageProbe({ context }: { context: string }) {
    const { useEffect } = jest.requireActual("react");
    useEffect(() => {
      mockStageMounted();
    }, []);
    return <div data-testid="stage">{context}</div>;
  },
}));
jest.mock("./views/FacilitiesContainer", () => ({
  __esModule: true,
  default: function FleetProbe() {
    const { useEffect } = jest.requireActual("react");
    useEffect(() => {
      mockFleetMounted();
    }, []);
    return <div>Fleet</div>;
  },
}));
jest.mock("./views/EventLogContainer", () => () => <div>Events</div>);
jest.mock("./base/GameAppBar", () => () => null);
jest.mock("./base/NavigationContainer", () => () => null);
jest.mock("./base/AudioContainer", () => () => null);
jest.mock("./base/VictoryDialogContainer", () => () => null);
jest.mock("./base/SaveTransitionDialog", () => () => null);
jest.mock("./base/DisplayNameDialogContainer", () => () => null);
jest.mock("./base/DataCenterGuide", () => () => null);
jest.mock("./base/LowCashWarning", () => () => null);

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

it.each([true, false])(
  "retains the stage and fleet across Build on desktop=%s",
  (desktop) => {
    (isDesktopScreen as jest.Mock).mockReturnValue(desktop);
    const state = store.getState();
    const props: Props = {
      card: { ...state.card, name: "FACILITIES", ts: 1 },
      settings: state.settings,
      ui: state.ui,
      transition: "nav",
      scenarioId: 103,
      tutorialStep: -1,
      closeDialog: jest.fn(),
      closeSnackbar: jest.fn(),
      onTutorialStep: jest.fn(),
      onTutorialEnd: jest.fn(),
    };
    const view = render(<Compositor {...props} />);
    const stage = screen.getByTestId("stage");
    view.rerender(
      <Compositor
        {...props}
        card={{ ...props.card, name: "BUILD_GENERATORS", ts: 2 }}
      />,
    );
    expect(screen.getByTestId("stage")).toBe(stage);
    expect(stage).toHaveTextContent("build");
    view.rerender(
      <Compositor
        {...props}
        card={{ ...props.card, name: "BUILD_STORAGE", ts: 3 }}
      />,
    );
    expect(screen.getByTestId("stage")).toBe(stage);
    view.rerender(
      <Compositor
        {...props}
        card={{ ...props.card, name: "FACILITIES", ts: 4 }}
      />,
    );
    expect(stage).toHaveTextContent("insights");
    expect(mockStageMounted).toHaveBeenCalledTimes(1);
    expect(mockFleetMounted).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
  },
);
