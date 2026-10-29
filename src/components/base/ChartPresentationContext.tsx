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
  const [viewportHeight, setViewportHeight] = React.useState(
    window.innerHeight,
  );
  React.useEffect(() => {
    const resize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const value = React.useMemo(
    () => ({
      height: Math.max(
        plots > 1 ? 220 : 260,
        Math.min(640, viewportHeight - 240) / plots,
      ),
      fontScale: 4 / 3,
    }),
    [viewportHeight, plots],
  );
  return (
    <ChartPresentationContext.Provider value={value}>
      {children}
    </ChartPresentationContext.Provider>
  );
}
