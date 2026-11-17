import * as React from "react";

/** One preference/visibility subscription for the whole map, never one per plant. */
export default function useFacilityMapMotion(): boolean {
  const [reduced] = React.useState(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)"),
  );
  const [allowed, setAllowed] = React.useState(
    () => !document.hidden && !reduced.matches,
  );
  React.useEffect(() => {
    const refresh = () => setAllowed(!document.hidden && !reduced.matches);
    reduced.addEventListener("change", refresh);
    document.addEventListener("visibilitychange", refresh);
    refresh();
    return () => {
      reduced.removeEventListener("change", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reduced]);
  return allowed;
}
