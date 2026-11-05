import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { Dialog, DialogTitle } from "@mui/material";
import { store } from "../Store";
import AchievementNotifications, {
  ACHIEVEMENT_TOAST_MS,
  AchievementGallery,
} from "./Interface";
import { dialogOpen, dialogClose } from "../reducers/UI";
import { achievementJournal } from "./Journal";
import { recordIntent } from "./Progress";

beforeEach(() => {
  localStorage.clear();
  achievementJournal.refresh();
  achievementJournal.clearNotifications();
});

test("simultaneous awards are all readable and dismiss independently", () => {
  const view = render(
    <Provider store={store}>
      <AchievementNotifications />
    </Provider>,
  );
  act(() => {
    achievementJournal.merge(
      recordIntent({ earned: ["FIRST_SPARK", "OUT_OF_JUICE", "CLEAN_FINISH"] }),
      true,
    );
  });
  const first = screen.getByRole("button", { name: /Dismiss First Spark/ });
  const second = screen.getByRole("button", { name: /Dismiss Out of Juice/ });
  const third = screen.getByRole("button", { name: /Dismiss Clean Finish/ });
  expect(first).toBeVisible();
  expect(second).toBeVisible();
  expect(third).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("First Spark");
  expect(screen.getByRole("status")).toHaveTextContent("Out of Juice");
  expect(screen.getByRole("status")).toHaveTextContent("Clean Finish");
  fireEvent.click(second);
  expect(second).not.toBeInTheDocument();
  expect(first).toBeVisible();
  expect(third).toBeVisible();
  view.unmount();
  achievementJournal.clearNotifications();
});

test("new awards appear while the completion modal is still open", () => {
  store.dispatch(
    dialogOpen({ open: true, title: "Mission complete!", message: "" }),
  );
  const view = render(
    <Provider store={store}>
      <Dialog open>
        <DialogTitle>Mission complete!</DialogTitle>
      </Dialog>
      <AchievementNotifications />
    </Provider>,
  );
  act(() => {
    achievementJournal.merge(recordIntent({ earned: ["LIGHTS_ON"] }), true);
  });
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(
    screen.getByRole("button", { name: /Dismiss Lights On/ }),
  ).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Achievement unlocked: Lights On",
  );
  view.unmount();
  achievementJournal.clearNotifications();
  store.dispatch(dialogClose());
});

test("synced accounts omit the account panel, while sync failures keep retry available", () => {
  achievementJournal.activate("achievement-interface-test");
  achievementJournal.setSync("synced");
  const view = render(
    <Provider store={store}>
      <AchievementGallery />
    </Provider>,
  );
  expect(screen.queryByText(/Synced to your account/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Saved on this device/)).not.toBeInTheDocument();
  act(() => achievementJournal.setSync("failed"));
  expect(screen.getByRole("button", { name: "Retry sync" })).toBeVisible();
  view.unmount();
  achievementJournal.activate();
});

test("the stack stays readable while any notification is focused or hovered", () => {
  jest.useFakeTimers();
  achievementJournal.merge(
    recordIntent({ earned: ["FIRST_SPARK", "OUT_OF_JUICE"] }),
    true,
  );
  const view = render(
    <Provider store={store}>
      <AchievementNotifications />
    </Provider>,
  );
  const close = screen.getByRole("button", { name: /Dismiss First Spark/ });
  const panel = screen.getAllByText("Achievement unlocked", { exact: true })[0];
  fireEvent.mouseEnter(panel);
  act(() => close.focus());
  fireEvent.mouseLeave(panel);
  act(() => jest.advanceTimersByTime(9000));
  expect(close).toBeInTheDocument();
  fireEvent.click(close);
  const next = screen.getByRole("button", { name: /Dismiss Out of Juice/ });
  expect(next).toHaveFocus();
  act(() => jest.advanceTimersByTime(9000));
  expect(next).toBeInTheDocument();
  fireEvent.mouseEnter(next);
  act(() => next.blur());
  act(() => jest.advanceTimersByTime(9000));
  expect(next).toBeInTheDocument();
  fireEvent.mouseLeave(next);
  act(() => jest.advanceTimersByTime(ACHIEVEMENT_TOAST_MS - 1));
  expect(next).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(1));
  expect(
    screen.queryByRole("button", { name: /Dismiss Out of Juice/ }),
  ).not.toBeInTheDocument();
  view.unmount();
  jest.useRealTimers();
});

test("an award arriving during the stack gets its own reading time", () => {
  jest.useFakeTimers();
  achievementJournal.merge(recordIntent({ earned: ["FIRST_SPARK"] }), true);
  const view = render(
    <Provider store={store}>
      <AchievementNotifications />
    </Provider>,
  );
  act(() => jest.advanceTimersByTime(ACHIEVEMENT_TOAST_MS - 1000));
  act(() => {
    achievementJournal.merge(recordIntent({ earned: ["OUT_OF_JUICE"] }), true);
  });
  expect(
    screen.getByRole("button", { name: /Dismiss First Spark/ }),
  ).toBeVisible();
  const later = screen.getByRole("button", { name: /Dismiss Out of Juice/ });
  expect(later).toBeVisible();
  act(() => jest.advanceTimersByTime(1000));
  expect(
    screen.queryByRole("button", { name: /Dismiss First Spark/ }),
  ).not.toBeInTheDocument();
  expect(later).toBeVisible();
  act(() => jest.advanceTimersByTime(ACHIEVEMENT_TOAST_MS - 1000));
  expect(later).not.toBeInTheDocument();
  view.unmount();
  jest.useRealTimers();
});

// jsdom has no PointerEvent; keep the coordinates and pointer identity the swipe reads.
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

test("a sideways or downward swipe dismisses the notification, a short drag does not", () => {
  const originalPointerEvent = window.PointerEvent;
  window.PointerEvent = TestPointerEvent as typeof PointerEvent;
  jest.useFakeTimers();
  achievementJournal.merge(
    recordIntent({ earned: ["FOUR_NINES", "CLEAN_FINISH"] }),
    true,
  );
  const view = render(
    <Provider store={store}>
      <AchievementNotifications />
    </Provider>,
  );
  // Pointer events bubble from the award title to its swipe handler.
  const drag = (name: string, to: { x: number; y: number }) => {
    const panel = screen.getByText(name, { exact: true });
    fireEvent.pointerDown(panel, {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(panel, {
      pointerId: 1,
      clientX: to.x,
      clientY: to.y,
    });
    fireEvent.pointerUp(panel, { pointerId: 1, clientX: to.x, clientY: to.y });
    act(() => jest.advanceTimersByTime(200));
  };
  drag("Four Nines", { x: 130, y: 110 });
  expect(
    screen.getByRole("button", { name: /Dismiss Four Nines/ }),
  ).toBeInTheDocument();
  drag("Four Nines", { x: 20, y: 100 });
  expect(
    screen.queryByRole("button", { name: /Dismiss Four Nines/ }),
  ).not.toBeInTheDocument();
  // Dismissing one card leaves the other in place, without a fling or faded state.
  expect(
    screen.getByRole("button", { name: /Dismiss Clean Finish/ }),
  ).toBeInTheDocument();
  drag("Clean Finish", { x: 100, y: 180 });
  expect(
    screen.queryByRole("button", { name: /Dismiss Clean Finish/ }),
  ).not.toBeInTheDocument();
  view.unmount();
  achievementJournal.clearNotifications();
  jest.useRealTimers();
  window.PointerEvent = originalPointerEvent;
});
