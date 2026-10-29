import * as React from "react";

/** Follow the resized option after React has updated costs, row heights and sort order. */
export default function useBuildRowReveal(
  container: React.RefObject<HTMLElement | null>,
) {
  const pending = React.useRef<string>();
  React.useLayoutEffect(() => {
    if (pending.current === undefined) return;
    const row = Array.from(
      container.current?.querySelectorAll<HTMLElement>("[data-build-option]") ??
        [],
    ).find((element) => element.dataset.buildOption === pending.current);
    row?.scrollIntoView?.({ block: "start", behavior: "instant" });
    pending.current = undefined;
  });
  return (name: string) => {
    pending.current = name;
  };
}
