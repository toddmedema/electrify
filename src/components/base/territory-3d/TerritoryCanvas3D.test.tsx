import * as React from "react";
import { act, render, waitFor } from "@testing-library/react";
import TerritoryCanvas3D, {
  RendererFactory,
  RendererHandle,
} from "./TerritoryCanvas3D";
import type { MapCanvas, MapFrame } from "./Types";

const frame: MapFrame = {
  width: 390,
  height: 600,
  dpr: 1,
  cameraX: 0,
  cameraY: 0,
  scale: 1,
  background: [0, 0, 0],
  lighting: {
    direction: [0, 1, 0],
    color: [1, 1, 1],
    ambient: 0.5,
    shadow: 0.2,
  },
  visible: true,
  motionAllowed: true,
  playbackRate: 1,
};
test("delayed loading uses the latest frame, retains one renderer and disposes diagnostics", async () => {
  let resolve!: (factory: RendererFactory) => void;
  const load = jest.fn(
    () =>
      new Promise<RendererFactory>((done) => {
        resolve = done;
      }),
  );
  const renderer: RendererHandle = {
    update: jest.fn(),
    dispose: jest.fn(),
    diagnostics: jest.fn(),
  };
  const factory = jest.fn(() => renderer),
    state = jest.fn();
  const utils = render(
    <TerritoryCanvas3D
      instances={[]}
      frame={frame}
      runKey="one"
      loadRenderer={load}
      onState={state}
    />,
  );
  const newer = { ...frame, cameraX: 500 };
  utils.rerender(
    <TerritoryCanvas3D
      instances={[]}
      frame={newer}
      runKey="one"
      loadRenderer={load}
      onState={state}
    />,
  );
  await act(async () => resolve(factory));
  await waitFor(() => expect(renderer.update).toHaveBeenCalledWith([], newer));
  expect(factory).toHaveBeenCalledTimes(1);
  // The decorative canvas is intentionally hidden from accessibility; inspect its resource lifetime.
  // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
  const canvas = utils.container.querySelector("canvas") as MapCanvas;
  expect(canvas.map3DDiagnostics).toBeDefined();
  utils.unmount();
  expect(renderer.dispose).toHaveBeenCalledTimes(1);
  expect(canvas.map3DDiagnostics).toBeUndefined();
});
test("unmounting during a delayed import never creates a renderer", async () => {
  let resolve!: (factory: RendererFactory) => void;
  const load = () =>
    new Promise<RendererFactory>((done) => {
      resolve = done;
    });
  const factory = jest.fn();
  const utils = render(
    <TerritoryCanvas3D
      instances={[]}
      frame={frame}
      runKey="one"
      loadRenderer={load}
      onState={jest.fn()}
    />,
  );
  utils.unmount();
  await act(async () => resolve(factory));
  expect(factory).not.toHaveBeenCalled();
});

test("renderer import failure reports the standard-map fallback and retains no diagnostics", async () => {
  const state = jest.fn(),
    connected = jest.fn();
  const utils = render(
    <TerritoryCanvas3D
      instances={[]}
      frame={frame}
      runKey="one"
      loadRenderer={async () => {
        throw new Error("chunk unavailable");
      }}
      onState={state}
      onRenderer={connected}
    />,
  );
  await waitFor(() => expect(state).toHaveBeenLastCalledWith("unavailable"));
  expect(state).toHaveBeenCalledWith("loading");
  expect(connected).toHaveBeenLastCalledWith(undefined);
  // The decorative canvas is intentionally absent from the accessibility tree.
  // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
  const canvas = utils.container.querySelector("canvas") as MapCanvas;
  expect(canvas.map3DDiagnostics).toBeUndefined();
});

test("a renderer update failure disposes partially initialized resources", async () => {
  const state = jest.fn(),
    connected = jest.fn();
  const renderer: RendererHandle = {
    update: jest.fn(() => {
      throw new Error("GPU unavailable");
    }),
    dispose: jest.fn(),
    diagnostics: jest.fn(),
  };
  render(
    <TerritoryCanvas3D
      instances={[]}
      frame={frame}
      runKey="one"
      loadRenderer={async () => () => renderer}
      onState={state}
      onRenderer={connected}
    />,
  );
  await waitFor(() => expect(state).toHaveBeenLastCalledWith("unavailable"));
  expect(renderer.dispose).toHaveBeenCalledTimes(1);
  expect(connected).toHaveBeenLastCalledWith(undefined);
});
