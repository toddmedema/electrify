import * as React from "react";
import { act, render } from "@testing-library/react";
import { store } from "../Store";
import { CARD_TRANSITION_ANIMATION_MS } from "../Constants";
import Compositor, { Props } from "./Compositor";

jest.mock("./base/AudioContainer", () => () => null);
jest.mock("./base/VictoryDialogContainer", () => () => null);
jest.mock("./base/DisplayNameDialogContainer", () => () => null);

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
