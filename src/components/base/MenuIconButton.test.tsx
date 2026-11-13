import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  resetInputPresentation,
  updateInputPresentation,
} from "../../desktop/InputPresentation";
import MenuIconButton from "./MenuIconButton";

const nativeMatches = Element.prototype.matches;

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Element.prototype, "matches").mockImplementation(function (
    this: Element,
    selector,
  ) {
    return selector === ":focus-visible"
      ? false
      : nativeMatches.call(this, selector);
  });
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 8,
    y: 100,
    width: 44,
    height: 44,
    top: 100,
    bottom: 144,
    left: 8,
    right: 52,
    toJSON: () => ({}),
  });
});

it("distinguishes hover selection from keyboard focus even when focus-visible is inherited", async () => {
  jest.spyOn(Element.prototype, "matches").mockImplementation(function (
    this: Element,
    selector,
  ) {
    return selector === ":focus-visible"
      ? true
      : nativeMatches.call(this, selector);
  });
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  render(
    <>
      <button>Play</button>
      <MenuIconButton label="Manual">Book</MenuIconButton>
    </>,
  );
  const manual = screen.getByRole("button", { name: "Manual" });
  await user.hover(manual);
  act(() => manual.focus());
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  act(() => jest.advanceTimersByTime(300));
  expect(screen.getByRole("tooltip")).toHaveTextContent("Manual");
  await user.unhover(manual);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  await user.tab({ shift: true });
  await user.tab();
  expect(screen.getByRole("tooltip")).toHaveTextContent("Manual");
});

afterEach(() => {
  resetInputPresentation();
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("waits for deliberate mouse hover, cancels passing hover, and ignores touch long-press", async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  render(<MenuIconButton label="Manual">Book</MenuIconButton>);
  const button = screen.getByRole("button", { name: "Manual" });
  await user.hover(button);
  act(() => jest.advanceTimersByTime(200));
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  await user.unhover(button);
  act(() => jest.advanceTimersByTime(300));
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  await user.hover(button);
  act(() => jest.advanceTimersByTime(300));
  expect(screen.getByRole("tooltip")).toHaveTextContent("Manual");
  await user.unhover(button);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  await user.pointer({ keys: "[TouchA>]", target: button });
  act(() => jest.advanceTimersByTime(1000));
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  await user.pointer({ keys: "[/TouchA]", target: button });
});

it("opens for controller selection without native focus-visible, respects Escape, and follows the next selection", async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  act(() => updateInputPresentation({ active: true, connected: true }));
  render(
    <>
      <MenuIconButton label="Manual">Book</MenuIconButton>
      <MenuIconButton label="Send feedback">Email</MenuIconButton>
    </>,
  );
  act(() => screen.getByRole("button", { name: "Manual" }).focus());
  expect(screen.getByRole("tooltip")).toHaveTextContent("Manual");
  await user.keyboard("{Escape}");
  act(() => jest.advanceTimersByTime(500));
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Manual" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Send feedback" })).toHaveFocus();
  expect(screen.getAllByRole("tooltip")).toHaveLength(1);
  expect(screen.getByRole("tooltip")).toHaveTextContent("Send feedback");
});
