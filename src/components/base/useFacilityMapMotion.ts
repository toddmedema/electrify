import * as React from "react";
import type { SpeedType } from "../../Types";

export const FACILITY_MAP_PLAYBACK_RATE: Record<SpeedType, number> = {
  PAUSED: 0.25,
  SLOW: 0.7,
  NORMAL: 1,
  FAST: 1.2,
  ULTRA: 1.5,
};

export const FacilityMapMotionContext = React.createContext({
  allowed: true,
  rate: FACILITY_MAP_PLAYBACK_RATE.PAUSED,
});

/** One preference/visibility subscription for the whole map, never one per plant. */
export default function useFacilityMapMotion(speed: SpeedType = "PAUSED") {
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
  return React.useMemo(
    () => ({ allowed, rate: FACILITY_MAP_PLAYBACK_RATE[speed] }),
    [allowed, speed],
  );
}

/** Keep the same CSS animations alive: pause retains phase; retiming never seeks. */
export function useFacilityAnimation(active: boolean, variant: string) {
  const { allowed, rate } = React.useContext(FacilityMapMotionContext);
  const moving = active && allowed;
  const ref = useMapAnimationPlayback<SVGSVGElement>(moving, rate, variant);
  return { ref, moving };
}

export function useMapAnimationPlayback<T extends Element>(
  moving: boolean,
  rate: number,
  variant: string | number,
) {
  const ref = React.useRef<T>(null);
  React.useLayoutEffect(() => {
    for (const animation of ref.current?.getAnimations?.({ subtree: true }) ??
      []) {
      if ("transitionProperty" in animation) continue;
      if (animation.playbackRate !== rate) animation.updatePlaybackRate(rate);
      if (moving) {
        if (animation.playState !== "running") animation.play();
      } else if (animation.playState !== "paused") animation.pause();
    }
  }, [moving, rate, variant]);
  return ref;
}
