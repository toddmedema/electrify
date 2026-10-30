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
