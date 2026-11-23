import { render, screen } from "@testing-library/react";
import useFacilityMapMotion from "../base/useFacilityMapMotion";

beforeEach(() => {
  const media = new EventTarget() as MediaQueryList;
  Object.defineProperty(media, "matches", { value: false });
  jest.spyOn(window, "matchMedia").mockReturnValue(media);
  jest.spyOn(document, "hidden", "get").mockReturnValue(false);
});
afterEach(() => jest.restoreAllMocks());

it("releases the map's single media and document visibility subscriptions", () => {
  const removeMedia = jest.spyOn(
    window.matchMedia("(prefers-reduced-motion: reduce)"),
    "removeEventListener",
  );
  const removeDocument = jest.spyOn(document, "removeEventListener");
  function Motion() {
    return (
      <output>{useFacilityMapMotion().allowed ? "Moving" : "Still"}</output>
    );
  }
  const { unmount } = render(<Motion />);
  expect(screen.getByRole("status")).toHaveTextContent("Moving");
  unmount();
  expect(removeMedia).toHaveBeenCalledWith("change", expect.any(Function));
  expect(removeDocument).toHaveBeenCalledWith(
    "visibilitychange",
    expect.any(Function),
  );
});
