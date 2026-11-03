import * as React from "react";

/** Transient chart inspection; compact charts retain their existing presentation. */
export const ChartPresentationContext = React.createContext<{
  height: number;
  fontScale: number;
} | null>(null);

export function ExpandedChartPresentation({
  children,
  plots = 1,
}: {
  children: React.ReactNode;
  plots?: number;
}) {
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const [plotHeight, setPlotHeight] = React.useState(260);
  React.useLayoutEffect(() => {
    const body = bodyRef.current!;
    const children = Array.from(body.children);
    const measure = () => {
      const available = body.getBoundingClientRect().height;
      if (available <= 0) return;
      const charts = Array.from(body.querySelectorAll(".accessibleChart"));
      // The body has a fixed flex allocation. Subtract the actual legends, filters, notes,
      // and margins rather than guessing how much viewport height the dialog chrome spends.
      const contentHeight = children.reduce((total, child) => {
        const style = getComputedStyle(child);
        return (
          total +
          child.getBoundingClientRect().height +
          (parseFloat(style.marginTop) || 0) +
          (parseFloat(style.marginBottom) || 0)
        );
      }, 0);
      const canvasHeight = charts.reduce(
        (total, chart) => total + chart.getBoundingClientRect().height,
        0,
      );
      const next = Math.max(
        1,
        Math.floor((available - (contentHeight - canvasHeight)) / plots),
      );
      setPlotHeight((previous) => (previous === next ? previous : next));
    };
    measure();
    // Watching the fixed body catches dialog/viewport resizes; its children catch wrapping
    // controls, changed notes, and the user's text-size setting without a window estimate.
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    children.forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [children, plots]);
  const value = React.useMemo(
    () => ({
      height: plotHeight,
      fontScale: 4 / 3,
    }),
    [plotHeight],
  );
  return (
    <ChartPresentationContext.Provider value={value}>
      <div className="expandedChartBody" ref={bodyRef}>
        {children}
      </div>
    </ChartPresentationContext.Provider>
  );
}
