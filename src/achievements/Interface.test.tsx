import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { Dialog, DialogTitle } from "@mui/material";
import { store } from "../Store";
import AchievementNotifications, { AchievementGallery } from "./Interface";
import { dialogOpen, dialogClose } from "../reducers/UI";
import { achievementJournal } from "./Journal";
import { recordIntent } from "./Progress";

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

test("queued notifications keep their timer paused while focused or hovered", () => {
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
  const panel = screen.getByText("Achievement unlocked", { exact: true });
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
  fireEvent.mouseEnter(panel);
  act(() => next.blur());
  act(() => jest.advanceTimersByTime(9000));
  expect(next).toBeInTheDocument();
  fireEvent.mouseLeave(panel);
  act(() => jest.advanceTimersByTime(9000));
  expect(
    screen.queryByRole("button", { name: /Dismiss Out of Juice/ }),
  ).not.toBeInTheDocument();
  view.unmount();
  jest.useRealTimers();
});
