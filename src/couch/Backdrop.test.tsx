import { act, render } from "@testing-library/react";
import CouchBackdrop from "./Backdrop";
import type { CouchOverlayBackdrop } from "./Backdrop";

const backdrop: CouchOverlayBackdrop = {
  owner: "local-p1",
  version: 3,
  captureId: 7,
  viewport: { width: 1920, height: 1080 },
  snapshots: [
    {
      seatId: "local-p1",
      generation: 1,
      bounds: { x: 0, y: 80, width: 956, height: 1000 },
      image: "data:image/png;base64,preview",
    },
  ],
};

const originalDecode = Object.getOwnPropertyDescriptor(
  HTMLImageElement.prototype,
  "decode",
);
afterEach(() => {
  jest.restoreAllMocks();
  if (originalDecode)
    Object.defineProperty(HTMLImageElement.prototype, "decode", originalDecode);
  else Reflect.deleteProperty(HTMLImageElement.prototype, "decode");
});

function pendingImage() {
  let resolve!: () => void;
  Object.defineProperty(HTMLImageElement.prototype, "decode", {
    configurable: true,
    value: () => new Promise<void>((done) => (resolve = done)),
  });
  const frames: FrameRequestCallback[] = [];
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  return { decoded: () => resolve(), frames };
}

it("acknowledges the exact capture only after its images decode and get a paint opportunity", async () => {
  const { decoded, frames } = pendingImage();
  const onReady = jest.fn();
  render(<CouchBackdrop backdrop={backdrop} onReady={onReady} />);
  expect(frames).toHaveLength(0);
  expect(onReady).not.toHaveBeenCalled();
  await act(async () => decoded());
  expect(onReady).not.toHaveBeenCalled();
  act(() => frames.shift()!(0));
  expect(onReady).not.toHaveBeenCalled();
  act(() => frames.shift()!(16));
  expect(onReady).toHaveBeenCalledTimes(1);
  expect(onReady).toHaveBeenCalledWith(3, 7);
});

it("does not hide native views for a capture whose overlay closed during decode", async () => {
  const { decoded, frames } = pendingImage();
  const onReady = jest.fn();
  const view = render(<CouchBackdrop backdrop={backdrop} onReady={onReady} />);
  view.unmount();
  await act(async () => decoded());
  expect(frames).toHaveLength(0);
  expect(onReady).not.toHaveBeenCalled();
});

it("does not acknowledge a replaced capture while its paint callback is pending", async () => {
  const { decoded, frames } = pendingImage();
  const onReady = jest.fn();
  const view = render(<CouchBackdrop backdrop={backdrop} onReady={onReady} />);
  await act(async () => decoded());
  act(() => frames.shift()!(0));
  const stalePaint = frames.shift()!;
  view.rerender(
    <CouchBackdrop
      backdrop={{ ...backdrop, captureId: 8 }}
      onReady={onReady}
    />,
  );
  act(() => stalePaint(16));
  expect(onReady).not.toHaveBeenCalled();
});
