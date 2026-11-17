import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../Store";
import { CARD_TRANSITION_ANIMATION_MS } from "../Constants";
import Compositor, { Props } from "./Compositor";

jest.mock("./base/AudioContainer", () => () => null);
jest.mock("./base/VictoryDialogContainer", () => () => null);
jest.mock("./base/CampaignHandoverContainer", () => () => null);
jest.mock("./base/SaveTransitionDialog", () => () => null);
jest.mock("./base/DisplayNameDialogContainer", () => () => null);
jest.mock("./base/DataCenterGuide", () => () => null);
jest.mock("./base/LowCashWarning", () => () => null);
let mockScreenAttempts = 0;
let mockHelpAttempts = 0;
jest.mock("./views/NewGameContainer", () => {
  if (++mockScreenAttempts === 1) throw new Error("Screen download failed");
  return { __esModule: true, default: () => <p>Recovered screen</p> };
});
jest.mock("./base/ManualHelpPopover", () => {
  if (++mockHelpAttempts === 1) throw new Error("Help download failed");
  return { __esModule: true, default: () => <p>Recovered help</p> };
});
jest.mock("./base/GameWorkspace", () => () => {
  const [clicks, setClicks] = jest
    .requireActual<typeof import("react")>("react")
    .useState(0);
  return (
    <button onClick={() => setClicks(clicks + 1)}>
      Retained workspace {clicks}
    </button>
  );
});

it.each(["screen", "help"])(
  "contains a rejected %s download and preserves the app and game state",
  async (kind) => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    const state = store.getState();
    const props: Props = {
      card: {
        ...state.card,
        name: kind === "screen" ? "NEW_GAME" : "FACILITIES",
      },
      settings: state.settings,
      ui: state.ui,
      transition: "next",
      scenarioId: 1,
      tutorialStep: -1,
      closeDialog: jest.fn(),
      closeSnackbar: jest.fn(),
      onTutorialStep: jest.fn(),
      onTutorialEnd: jest.fn(),
    };
    const compositor = React.createRef<Compositor>();
    const view = render(
      <Provider store={store}>
        <Compositor ref={compositor} {...props} />
      </Provider>,
    );
    const instance = compositor.current;
    try {
      if (kind === "help") {
        const workspace = await screen.findByRole("button", {
          name: "Retained workspace 0",
        });
        fireEvent.click(workspace);
        view.rerender(
          <Provider store={store}>
            <Compositor
              ref={compositor}
              {...props}
              ui={{ ...props.ui, manualHelpEntry: "Demand" }}
            />
          </Provider>,
        );
      }
      expect(await screen.findByRole("dialog")).toHaveTextContent(
        "couldn't load",
      );
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(await screen.findByText(`Recovered ${kind}`)).toBeVisible();
      expect(kind === "screen" ? mockScreenAttempts : mockHelpAttempts).toBe(2);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(compositor.current).toBe(instance);
      expect(store.getState()).toBe(state);
      const retainedScreen =
        kind === "help" ? "Retained workspace 1" : "Recovered screen";
      expect(screen.getByText(retainedScreen)).toBeInTheDocument();
      view.rerender(
        <Provider store={store}>
          <Compositor ref={compositor} {...props} />
        </Provider>,
      );
      expect(screen.getByText(retainedScreen)).toBeVisible();
    } finally {
      view.unmount();
      error.mockRestore();
    }
  },
);

it("starts a fresh loader when retry occurs before the previous loader exits", () => {
  jest.useFakeTimers();
  const mounted = jest.fn();
  function LoadingProbe() {
    React.useEffect(() => {
      mounted();
    }, []);
    return <div>Loading</div>;
  }
  const renderCard = jest
    .spyOn(
      Compositor.prototype as unknown as {
        renderCard: () => React.JSX.Element;
      },
      "renderCard",
    )
    .mockImplementation(function (this: Compositor) {
      return this.props.card.name === "LOADING" ? (
        <LoadingProbe />
      ) : (
        <div>Facilities</div>
      );
    });
  const state = store.getState();
  const props: Props = {
    card: { ...state.card, name: "LOADING", ts: 1 },
    settings: state.settings,
    ui: state.ui,
    transition: "next",
    scenarioId: 1,
    tutorialStep: 0,
    closeDialog: jest.fn(),
    closeSnackbar: jest.fn(),
    onTutorialStep: jest.fn(),
    onTutorialEnd: jest.fn(),
  };
  const view = render(<Compositor {...props} />);
  try {
    expect(mounted).toHaveBeenCalledTimes(1);
    view.rerender(
      <Compositor
        {...props}
        card={{ ...props.card, name: "FACILITIES", ts: 2 }}
      />,
    );
    act(() => jest.advanceTimersByTime(CARD_TRANSITION_ANIMATION_MS / 2));
    view.rerender(
      <Compositor
        {...props}
        card={{ ...props.card, name: "LOADING", ts: 3 }}
      />,
    );
    expect(mounted).toHaveBeenCalledTimes(2);
    act(() => jest.advanceTimersByTime(CARD_TRANSITION_ANIMATION_MS));
    expect(mounted).toHaveBeenCalledTimes(2);
    view.rerender(
      <Compositor
        {...props}
        card={{ ...props.card, name: "LOADING", ts: 4 }}
      />,
    );
    expect(mounted).toHaveBeenCalledTimes(3);
  } finally {
    view.unmount();
    renderCard.mockRestore();
    jest.useRealTimers();
  }
});

it("keeps toast results visible through page clicks while allowing timeout and explicit dismissal", () => {
  jest.useFakeTimers();
  const renderCard = jest
    .spyOn(
      Compositor.prototype as unknown as {
        renderCard: () => React.JSX.Element;
      },
      "renderCard",
    )
    .mockReturnValue(<button>Another mod action</button>);
  const state = store.getState();
  const closeSnackbar = jest.fn();
  const props: Props = {
    card: state.card,
    settings: state.settings,
    ui: {
      ...state.ui,
      snackbar: { open: true, message: "Mod imported.", timeout: 10000 },
    },
    transition: "next",
    scenarioId: 1,
    tutorialStep: -1,
    closeDialog: jest.fn(),
    closeSnackbar,
    onTutorialStep: jest.fn(),
    onTutorialEnd: jest.fn(),
  };
  const view = render(<Compositor {...props} />);
  try {
    act(() => jest.advanceTimersByTime(1));
    fireEvent.click(screen.getByRole("button", { name: "Another mod action" }));
    expect(closeSnackbar).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(10000));
    expect(closeSnackbar).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );
    expect(closeSnackbar).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
    renderCard.mockRestore();
    jest.useRealTimers();
  }
});
