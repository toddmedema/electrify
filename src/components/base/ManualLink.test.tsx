import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../../Store";
import { manualHelpClose } from "../../reducers/UI";
import { MANUAL_ENTRY, MANUAL_SECTION } from "./ManualEntries";
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

// Runs the hover delay, then the fade the preview leaves on
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

  it("previews its entry while a mouse rests on it and hides it on leaving", () => {
    const link = showLink();
    hover(link);
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

  it("previews only the requested chart subsection and follows its related entry", () => {
    const link = showLink(MANUAL_SECTION.SUPPLY_DEMAND);
    hover(link);
    settle();
    const help = preview()!;
    expect(
      within(help).getByRole("heading", { name: "Supply & Demand" }),
    ).toBeVisible();
    expect(help).toHaveTextContent("missing energy");
    expect(within(help).queryByRole("heading", { name: "Cash" })).toBeNull();
    expect(help).not.toHaveTextContent("Choose a preset");
    fireEvent.click(within(help).getByRole("link", { name: "blackouts" }));
    expect(store.getState().ui.manualHelpEntry).toBe(MANUAL_ENTRY.BLACKOUTS);
  });

  it("ignores a (?) that arrives beneath a mouse that hasn't moved", () => {
    const link = showLink();
    fireEvent.pointerEnter(link, { pointerType: "mouse" });
    settle();
    expect(preview()).toBeNull();
    fireEvent.pointerMove(link, { pointerType: "mouse" });
    settle();
    expect(preview()).not.toBeNull();
  });

  it("keeps its open delay running while the mouse keeps moving", () => {
    const link = showLink();
    hover(link);
    act(() => jest.advanceTimersByTime(200));
    fireEvent.pointerMove(link, { pointerType: "mouse" });
    act(() => jest.advanceTimersByTime(100));
    expect(preview()).not.toBeNull();
  });

  it("consumes Escape before workspace navigation and suppresses hover until leaving", () => {
    const link = showLink();
    const workspaceEscape = jest.fn();
    document.addEventListener("keydown", workspaceEscape);
    try {
      hover(link);
      settle();
      expect(preview()).not.toBeNull();
      fireEvent.keyDown(document.body, { key: "Escape" });
      settle();
      expect(preview()).toBeNull();
      expect(workspaceEscape).not.toHaveBeenCalled();
      hover(link);
      settle();
      expect(preview()).toBeNull();
      fireEvent.pointerLeave(link, { pointerType: "mouse" });
      hover(link);
      settle();
      expect(preview()).not.toBeNull();
    } finally {
      document.removeEventListener("keydown", workspaceEscape);
    }
  });

  it("leaves touch to the tap, which pins the entry open", () => {
    const link = showLink();
    fireEvent.pointerMove(link, { pointerType: "touch" });
    settle();
    expect(preview()).toBeNull();
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

  it("gives way to the pinned entry when clicked mid-hover", () => {
    const link = showLink();
    hover(link);
    fireEvent.click(link);
    settle();
    expect(preview()).toBeNull();
    // Closing the pinned entry with the mouse still on the (?) doesn't bring the preview back,
    // though the browser reports the mouse entering it again as the backdrop goes
    fireEvent.pointerLeave(link, { pointerType: "mouse" });
    act(() => {
      store.dispatch(manualHelpClose());
    });
    hover(link);
    settle();
    expect(preview()).toBeNull();
    // Once the mouse has really left, hovering previews again
    fireEvent.pointerLeave(link, { pointerType: "mouse" });
    hover(link);
    settle();
    expect(preview()).not.toBeNull();
  });
});
