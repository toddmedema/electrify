import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../../Store";
import { manualHelpClose } from "../../reducers/UI";
import { MANUAL_ENTRY } from "./ManualEntries";
import ManualLink from "./ManualLink";

function showLink() {
  render(
    <Provider store={store}>
      <ManualLink entry={MANUAL_ENTRY.POWER_AND_ENERGY} />
    </Provider>,
  );
  return screen.getByRole("button", { name: "What is Power and Energy?" });
}

// Runs the hover delay, then the fade the preview leaves on
function settle() {
  act(() => jest.advanceTimersByTime(500));
  act(() => jest.advanceTimersByTime(500));
}

function preview() {
  return screen.queryByRole("dialog", { name: "Manual preview" });
}

// jsdom has no PointerEvent, so fireEvent would build a plain Event and drop pointerType
class TestPointerEvent extends MouseEvent {
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerType = init.pointerType || "";
  }
}

beforeAll(() => {
  (window as unknown as { PointerEvent: unknown }).PointerEvent =
    TestPointerEvent;
});

describe("ManualLink", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    store.dispatch(manualHelpClose());
  });

  it("previews its entry while a mouse rests on it and hides it on leaving", () => {
    const link = showLink();
    fireEvent.pointerEnter(link, { pointerType: "mouse" });
    expect(preview()).toBeNull();
    act(() => jest.advanceTimersByTime(300));
    expect(preview()).toHaveTextContent("how fast electricity is produced");
    // Hovering doesn't pin the entry, so the game keeps running
    expect(store.getState().ui.manualHelpEntry).toBeUndefined();

    // Crossing from the (?) onto the preview keeps it open
    fireEvent.pointerLeave(link, { pointerType: "mouse" });
    fireEvent.pointerEnter(preview()!, { pointerType: "mouse" });
    settle();
    expect(preview()).not.toBeNull();

    fireEvent.pointerLeave(preview()!, { pointerType: "mouse" });
    settle();
    expect(preview()).toBeNull();
  });

  it("leaves touch to the tap, which pins the entry open", () => {
    const link = showLink();
    fireEvent.pointerEnter(link, { pointerType: "touch" });
    settle();
    expect(preview()).toBeNull();
    fireEvent.click(link);
    expect(store.getState().ui.manualHelpEntry).toBe(
      MANUAL_ENTRY.POWER_AND_ENERGY,
    );
  });

  it("gives way to the pinned entry when clicked mid-hover", () => {
    const link = showLink();
    fireEvent.pointerEnter(link, { pointerType: "mouse" });
    fireEvent.click(link);
    settle();
    expect(preview()).toBeNull();
    // Closing the pinned entry with the mouse still on the (?) doesn't bring the preview back,
    // though the browser reports the mouse entering it again as the backdrop goes
    fireEvent.pointerLeave(link, { pointerType: "mouse" });
    act(() => {
      store.dispatch(manualHelpClose());
    });
    fireEvent.pointerEnter(link, { pointerType: "mouse" });
    settle();
    expect(preview()).toBeNull();
    // Once the mouse has really left, hovering previews again
    fireEvent.pointerLeave(link, { pointerType: "mouse" });
    fireEvent.pointerEnter(link, { pointerType: "mouse" });
    settle();
    expect(preview()).not.toBeNull();
  });
});
