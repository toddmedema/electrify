import * as React from "react";
import type {
  MapCanvas,
  MapFrame,
  MapInstance,
  PaintedScene,
  RendererDiagnostics,
} from "./Types";
import "./TerritoryCanvas3D.scss";

export type RendererState = "loading" | "ready" | "lost" | "unavailable";
export interface RendererHandle {
  update: (instances: readonly MapInstance[], frame: MapFrame) => void;
  diagnostics: (includeScene?: boolean) => RendererDiagnostics;
  getPaintedScene: () => PaintedScene | undefined;
  motionPhase: (key: string) => number;
  dispose: () => void;
}
export type RendererFactory = (
  canvas: MapCanvas,
  onState: (state: RendererState) => void,
) => RendererHandle;
export type RendererLoader = () => Promise<RendererFactory>;

/** React owns the canvas lifetime; the renderer owns frames, buffers and animation phases. */
export default function TerritoryCanvas3D({
  instances,
  frame,
  runKey,
  loadRenderer,
  onState,
  onRenderer,
}: {
  instances: readonly MapInstance[];
  frame: MapFrame;
  runKey: string;
  loadRenderer: RendererLoader;
  onState: (state: RendererState) => void;
  onRenderer?: (renderer: RendererHandle | undefined) => void;
}) {
  const canvas = React.useRef<MapCanvas>(null);
  const renderer = React.useRef<RendererHandle>();
  const latest = React.useRef({ instances, frame, onState, onRenderer });
  React.useLayoutEffect(() => {
    latest.current = { instances, frame, onState, onRenderer };
  }, [instances, frame, onState, onRenderer]);
  const [state, setState] = React.useState<RendererState | "loading">(
    "loading",
  );
  React.useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let live = true;
    setState("loading");
    latest.current.onState("loading");
    void (async () => loadRenderer())()
      .then((factory) => {
        if (!live) return;
        const value = factory(element, (next) => {
          if (!live) return;
          setState((previous) => (previous === next ? previous : next));
          latest.current.onState(next);
        });
        renderer.current = value;
        latest.current.onRenderer?.(value);
        if (!element.map3DDiagnostics)
          Object.defineProperty(element, "map3DDiagnostics", {
            value: (includeScene?: boolean) => value.diagnostics(includeScene),
            configurable: true,
          });
        value.update(latest.current.instances, latest.current.frame);
      })
      .catch(() => {
        if (!live) return;
        renderer.current?.dispose();
        renderer.current = undefined;
        latest.current.onRenderer?.(undefined);
        delete element.map3DDiagnostics;
        setState("unavailable");
        latest.current.onState("unavailable");
      });
    return () => {
      live = false;
      renderer.current?.dispose();
      renderer.current = undefined;
      latest.current.onRenderer?.(undefined);
      delete element.map3DDiagnostics;
    };
  }, [loadRenderer, runKey]);
  React.useLayoutEffect(() => {
    renderer.current?.update(instances, frame);
  }, [instances, frame]);
  return (
    <canvas
      ref={canvas}
      className="territory3DCanvas"
      data-renderer={state}
      aria-hidden="true"
    />
  );
}
