import * as React from "react";

const MapCoveredContext = React.createContext(false);
const CoverMapContext = React.createContext<(() => () => void) | undefined>(
  undefined,
);

export function WorkspaceMapRendering({
  children,
}: {
  children: React.ReactNode;
}) {
  const [covers, setCovers] = React.useState(0);
  const cover = React.useCallback(() => {
    setCovers((count) => count + 1);
    return () => setCovers((count) => count - 1);
  }, []);
  return (
    <CoverMapContext.Provider value={cover}>
      <MapCoveredContext.Provider value={covers > 0}>
        {children}
      </MapCoveredContext.Provider>
    </CoverMapContext.Provider>
  );
}

export function useMapCovered() {
  return React.useContext(MapCoveredContext);
}

/** An opaque full-screen presentation can keep the map mounted without drawing it. */
export function SuspendCoveredMap() {
  const cover = React.useContext(CoverMapContext);
  React.useLayoutEffect(() => cover?.(), [cover]);
  return null;
}
