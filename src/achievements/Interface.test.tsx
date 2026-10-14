import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../Store";
import AchievementNotifications from "./Interface";
import { achievementJournal } from "./Journal";
import { recordIntent } from "./Progress";

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
