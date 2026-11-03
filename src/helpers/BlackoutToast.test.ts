import {
  BLACKOUT_OVER_TOAST,
  BLACKOUT_TOAST_PREFIX,
  blackoutToastCanShow,
} from "./BlackoutToast";

const started = `${BLACKOUT_TOAST_PREFIX} 31MW short.`;

it("replaces a shown or held blackout toast when the blackout ends", () => {
  expect(blackoutToastCanShow({ open: true, message: started })).toBe(true);
});

it("replaces a shown or held all-clear when a new blackout starts", () => {
  expect(
    blackoutToastCanShow({ open: true, message: BLACKOUT_OVER_TOAST }),
  ).toBe(true);
});

it("still yields to an unrelated toast, and shows when nothing is open", () => {
  expect(blackoutToastCanShow({ open: true, message: "Paused Coal" })).toBe(
    false,
  );
  expect(blackoutToastCanShow({ open: false, message: "" })).toBe(true);
});
