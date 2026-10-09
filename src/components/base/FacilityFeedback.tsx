import * as React from "react";
import { GameType } from "../../Types";
import { facilityHazardStatus } from "../../helpers/Hazards";

type Milestone = "Commissioned" | "Outage ended";
interface Feedback {
  milestones: Readonly<Partial<Record<number, Milestone>>>;
  arrivingFacilityId?: number;
}
const EMPTY: Feedback = { milestones: {} };
const Context = React.createContext<Feedback>(EMPTY);

export const useFacilityFeedback = () => React.useContext(Context);

/** Observe the entire fleet once, independently of which view or detail is mounted. */
export function FacilityFeedbackProvider({
  game,
  arrivingFacilityId,
  onArrivalShown,
  children,
}: {
  game: GameType;
  arrivingFacilityId?: number;
  onArrivalShown?: (id: number) => void;
  children: React.ReactNode;
}) {
  const previous = React.useRef(
    new Map<number, { building: boolean; outage: boolean }>(),
  );
  const [milestones, setMilestones] = React.useState<
    Partial<Record<number, Milestone>>
  >({});
  const [arriving, setArriving] = React.useState<number>();
  const [announcement, setAnnouncement] = React.useState("");
  const consumedArrival = React.useRef<number>();
  const timers = React.useRef(new Map<number, number>());
  const readOnly = !!game.replayPlayback;

  React.useEffect(() => {
    const next = new Map<number, { building: boolean; outage: boolean }>();
    const changes: { id: number; label: Milestone; message: string }[] = [];
    for (const facility of game.facilities) {
      const building = facility.yearsToBuildLeft > 0;
      const outage = !!facilityHazardStatus(game, facility);
      const before = previous.current.get(facility.id);
      next.set(facility.id, { building, outage });
      if (readOnly || !before) continue;
      const operation = facility.paused ? " Operation is paused." : "";
      if (before.building && !building) {
        changes.push({
          id: facility.id,
          label: "Commissioned",
          message: `${facility.name}: construction complete.${operation}`,
        });
      } else if (before.outage && !outage && !building) {
        changes.push({
          id: facility.id,
          label: "Outage ended",
          message: `${facility.name}: weather outage ended.${operation}`,
        });
      }
    }
    previous.current = next;
    if (!changes.length) return;
    setAnnouncement(changes.map((change) => change.message).join(" "));
    setMilestones((current) => ({
      ...current,
      ...Object.fromEntries(changes.map((change) => [change.id, change.label])),
    }));
    for (const { id } of changes) {
      window.clearTimeout(timers.current.get(id));
      timers.current.set(
        id,
        window.setTimeout(() => {
          setMilestones((current) => {
            const remaining = { ...current };
            delete remaining[id];
            return remaining;
          });
          timers.current.delete(id);
        }, 6000),
      );
    }
  }, [game, readOnly]);

  React.useEffect(() => {
    if (!readOnly) return;
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
    setMilestones({});
    setArriving(undefined);
    setAnnouncement("");
  }, [readOnly]);

  React.useEffect(() => {
    if (
      readOnly ||
      arrivingFacilityId === undefined ||
      consumedArrival.current === arrivingFacilityId
    )
      return;
    const facility = game.facilities.find(
      (item) => item.id === arrivingFacilityId,
    );
    if (!facility) return;
    consumedArrival.current = arrivingFacilityId;
    setArriving(facility.id);
    setAnnouncement(
      `${facility.name}: ${facility.yearsToBuildLeft > 0 ? "construction started." : "added to the fleet."}`,
    );
    onArrivalShown?.(facility.id);
  }, [arrivingFacilityId, game.facilities, onArrivalShown, readOnly]);

  React.useEffect(() => {
    if (arriving === undefined) return;
    // Reduced motion does not fire animationend, so the cue's lifetime comes from a timer.
    const timer = window.setTimeout(() => setArriving(undefined), 240);
    return () => window.clearTimeout(timer);
  }, [arriving]);

  React.useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return (
    <Context.Provider
      value={readOnly ? EMPTY : { milestones, arrivingFacilityId: arriving }}
    >
      <span
        className="srOnly"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {readOnly ? "" : announcement}
      </span>
      {children}
    </Context.Provider>
  );
}
