import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../../Store";
import { manualHelpClose } from "../../reducers/UI";
import { MANUAL_ENTRY } from "./ManualEntries";
import ManualLink from "./ManualLink";

function showLink(
  entry: React.ComponentProps<
    typeof ManualLink
  >["entry"] = MANUAL_ENTRY.POWER_AND_ENERGY,
) {
  render(
    <Provider store={store}>
      <ManualLink entry={entry} />
    </Provider>,
  );
  return screen.getByRole("button", { name: `What is ${entry}?` });
}

// Wait beyond the former hover delay and fade.
function settle() {
  act(() => jest.advanceTimersByTime(500));
  act(() => jest.advanceTimersByTime(500));
}

function preview() {
  return screen.queryByRole("dialog", { name: "Manual preview" });
}

// A real mouse reports entering the link, then moving over it
function hover(link: HTMLElement) {
  fireEvent.pointerEnter(link, { pointerType: "mouse" });
  fireEvent.pointerMove(link, { pointerType: "mouse" });
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
    act(() => {
      store.dispatch(manualHelpClose());
    });
  });

  it("keeps help closed while a mouse rests on a term or it receives focus", () => {
    const link = showLink();
    hover(link);
    settle();
    expect(preview()).toBeNull();
    expect(store.getState().ui.manualHelpEntry).toBeUndefined();
    fireEvent.pointerLeave(link, { pointerType: "mouse" });
    act(() => link.focus());
    settle();
    expect(preview()).toBeNull();
    expect(store.getState().ui.manualHelpEntry).toBeUndefined();
  });

  it("opens the requested entry only when clicked", () => {
    const link = showLink();
    fireEvent.click(link);
    expect(store.getState().ui.manualHelpEntry).toBe(
      MANUAL_ENTRY.POWER_AND_ENERGY,
    );
  });

  it.each([
    [80, 0],
    [0, 80],
  ])("suppresses a synthesized click after a drag of %s, %s", (dx, dy) => {
    const link = showLink();
    const touch = { identifier: 1, clientX: 100, clientY: 100 };
    fireEvent.touchStart(link, { touches: [touch] });
    fireEvent.touchMove(link, {
      touches: [{ ...touch, clientX: 100 + dx, clientY: 100 + dy }],
    });
    expect(fireEvent.touchEnd(link, { touches: [] })).toBe(false);
    expect(store.getState().ui.manualHelpEntry).toBeUndefined();
    // A following tap still opens the entry.
    fireEvent.touchStart(link, { touches: [touch] });
    expect(fireEvent.touchEnd(link, { touches: [] })).toBe(true);
    fireEvent.click(link);
    expect(store.getState().ui.manualHelpEntry).toBe(
      MANUAL_ENTRY.POWER_AND_ENERGY,
    );
  });

  it("keeps help closed after dismissal until another click", () => {
    const link = showLink();
    fireEvent.click(link);
    act(() => {
      store.dispatch(manualHelpClose());
    });
    hover(link);
    settle();
    expect(preview()).toBeNull();
    expect(store.getState().ui.manualHelpEntry).toBeUndefined();
    fireEvent.click(link);
    expect(store.getState().ui.manualHelpEntry).toBe(
      MANUAL_ENTRY.POWER_AND_ENERGY,
    );
  });
});
