import { shouldDismissSnackbarSwipe } from "./Compositor";

describe("snackbar swipe dismissal", () => {
  it("dismisses left, right, and downward swipes", () => {
    expect(
      shouldDismissSnackbarSwipe({ x: 100, y: 100 }, { x: 30, y: 100 }),
    ).toBe(true);
    expect(
      shouldDismissSnackbarSwipe({ x: 100, y: 100 }, { x: 170, y: 100 }),
    ).toBe(true);
    expect(
      shouldDismissSnackbarSwipe({ x: 100, y: 100 }, { x: 100, y: 170 }),
    ).toBe(true);
  });

  it("keeps short gestures and upward page movement open", () => {
    expect(
      shouldDismissSnackbarSwipe({ x: 100, y: 100 }, { x: 130, y: 125 }),
    ).toBe(false);
    expect(
      shouldDismissSnackbarSwipe({ x: 100, y: 100 }, { x: 100, y: 20 }),
    ).toBe(false);
  });
});
