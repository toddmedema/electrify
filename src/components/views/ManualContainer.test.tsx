import { mapDispatchToProps } from "./ManualContainer";
import { restoreMenuFocus } from "../base/useMenuKeys";

jest.mock("../base/useMenuKeys", () => ({
  ...jest.requireActual("../base/useMenuKeys"),
  restoreMenuFocus: jest.fn(),
}));

it("returns focus to whichever control opened the Manual", () => {
  const dispatch = jest.fn();
  mapDispatchToProps(dispatch).onBack();
  expect(dispatch).toHaveBeenCalledTimes(2);
  expect(restoreMenuFocus).toHaveBeenCalledWith("[data-manual-trigger]");
});

it("lets an embedding dialog own Back without navigating the solo card history", () => {
  const dispatch = jest.fn();
  const onBack = jest.fn();
  mapDispatchToProps(dispatch, { onBack }).onBack();
  expect(onBack).toHaveBeenCalledTimes(1);
  // Clearing the manual's entry trail still belongs to this page.
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(dispatch.mock.calls[0][0].type).toBe("card/manualTrailCleared");
});
