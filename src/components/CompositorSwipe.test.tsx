import { shouldDismissSnackbarSwipe, snackbarSwipeOffset } from "./Compositor";

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

describe("snackbar swipe direction", () => {
  it("follows the dominant axis, sideways either way or down only", () => {
    expect(snackbarSwipeOffset({ x: 100, y: 100 }, { x: 20, y: 110 })).toEqual({
      axis: "x",
      distance: -80,
    });
    expect(snackbarSwipeOffset({ x: 100, y: 100 }, { x: 170, y: 90 })).toEqual({
      axis: "x",
      distance: 70,
    });
    expect(snackbarSwipeOffset({ x: 100, y: 100 }, { x: 110, y: 180 })).toEqual(
      { axis: "y", distance: 80 },
    );
    // Upward movement never lifts the toast.
    expect(snackbarSwipeOffset({ x: 100, y: 100 }, { x: 100, y: 20 })).toEqual({
      axis: "y",
      distance: 0,
    });
  });
});
