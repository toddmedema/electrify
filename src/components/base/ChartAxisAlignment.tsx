import * as React from "react";

/** Shares the measured left gutter of the charts currently mounted in one Insights page. */
function createAlignment() {
  const axes = new Map<object, { width: number; redraw: () => void }>();
  let width = 0;
  let frame: number | undefined;
  const schedule = () => {
    if (frame !== undefined) return;
    // Axis measurements happen during uPlot layout. Redraw siblings after that layout finishes.
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const next = Math.max(
        0,
        ...Array.from(axes.values(), (axis) => axis.width),
      );
      if (next === width) return;
      width = next;
      axes.forEach((axis) => axis.redraw());
    });
  };
  return {
    register(redraw: () => void) {
      const key = {};
      axes.set(key, { width: 0, redraw });
      return {
        measure(naturalWidth: number) {
          const axis = axes.get(key)!;
          if (axis.width !== naturalWidth) {
            axis.width = naturalWidth;
            schedule();
          }
          return Math.max(width, naturalWidth);
        },
        destroy() {
          axes.delete(key);
          if (axes.size) schedule();
          else {
            if (frame !== undefined) cancelAnimationFrame(frame);
            frame = undefined;
            width = 0;
          }
        },
      };
    },
  };
}

export const ChartAxisAlignmentContext = React.createContext<ReturnType<
  typeof createAlignment
> | null>(null);

export function ChartAxisAlignment({
  children,
}: {
  children: React.ReactNode;
}) {
  const alignment = React.useMemo(createAlignment, []);
  return (
    <ChartAxisAlignmentContext.Provider value={alignment}>
      {children}
    </ChartAxisAlignmentContext.Provider>
  );
}
