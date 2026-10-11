import * as React from "react";
import { FacilityOperatingType, GameType, isStorage } from "../../Types";
import { currentTick } from "../../helpers/GameSelectors";
import {
  formatFacilitySize,
  formatWatts,
  formatWattHours,
  formatWattsOfPeak,
} from "../../helpers/Format";
import { facilityHazardStatus, isUpgradingAt } from "../../helpers/Hazards";
import { combineStoryEffects } from "../../data/WorldEvents";
import { storyOutputMultiplier } from "../../helpers/Story";
import ConceptIcon from "../base/ConceptIcon";
import { facilityReservoirReading } from "../base/FacilityReservoir";
import "./FleetGrid.scss";

interface Props {
  game: GameType;
  selectedFacilityId: number | null;
  onSelect: (id: number | null) => void;
  onInspectInterties: () => void;
  children?: React.ReactNode;
}

interface FacilityGroup {
  key: string;
  name: string;
  storage: boolean;
  facilities: FacilityOperatingType[];
}

function groupFacilities(facilities: FacilityOperatingType[]): FacilityGroup[] {
  const groups = new Map<string, FacilityGroup>();
  facilities.forEach((facility) => {
    const storage = isStorage(facility);
    const key = `${storage ? "storage" : "generator"}:${facility.name}`;
    const group = groups.get(key);
    if (group) group.facilities.push(facility);
    else
      groups.set(key, {
        key,
        name: facility.name,
        storage,
        facilities: [facility],
      });
  });
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function facilityState(
  game: GameType,
  facility: FacilityOperatingType,
  limit: number,
) {
  if (facility.yearsToBuildLeft > 0) {
    return {
      text: `Building · ${Math.ceil(facility.yearsToBuildLeft * 12)} months left`,
      exception: "building",
    };
  }
  if (isUpgradingAt(facility, game.date.minute))
    return { text: "Offline for upgrade", exception: "offline for upgrade" };
  if (facility.paused) return { text: "Paused", exception: "paused" };
  const hazard = facilityHazardStatus(game, facility);
  if (hazard)
    return {
      text: `${hazard.label} · ${Math.round(hazard.availableFraction * 100)}% available`,
      exception: hazard.label.toLowerCase(),
    };
  if (limit < 1)
    return {
      text:
        limit === 0
          ? "Unavailable"
          : `Limited · ${Math.round(limit * 100)}% capacity`,
      exception: limit === 0 ? "unavailable" : "limited",
    };
  return {
    text: isStorage(facility)
      ? facility.currentW < 0
        ? `Charging · ${formatWatts(-facility.currentW)}`
        : facility.currentW > 0
          ? `Discharging · ${formatWatts(facility.currentW)}`
          : "Standby"
      : facility.currentW > 0
        ? "Supplying"
        : "Idle",
    exception: undefined,
  };
}

function GroupNode({
  group,
  game,
  limits,
  expanded,
  onOpen,
}: {
  group: FacilityGroup;
  game: GameType;
  limits: Map<number, number>;
  expanded: boolean;
  onOpen: () => void;
}) {
  // Construction is an exception in the fleet, not commissioned capacity or live flow.
  const operating = group.facilities.filter(
    (facility) => facility.yearsToBuildLeft <= 0,
  );
  const storage = operating.filter(isStorage);
  const outputW = operating.reduce(
    (sum, facility) => sum + Math.max(0, facility.currentW),
    0,
  );
  const chargingW = storage.reduce(
    (sum, facility) => sum + Math.max(0, -facility.currentW),
    0,
  );
  const peakW = operating.reduce((sum, facility) => sum + facility.peakW, 0);
  const storedWh = storage.reduce(
    (sum, facility) => sum + facility.currentWh,
    0,
  );
  const peakWh = storage.reduce((sum, facility) => sum + facility.peakWh, 0);
  const reservoirWh = operating.reduce(
    (sum, facility) => sum + (facility.reservoirWh || 0),
    0,
  );
  const reservoirCapacityWh = operating.reduce(
    (sum, facility) => sum + (facility.reservoirCapacityWh || 0),
    0,
  );
  const exceptions = new Map<string, number>();
  const addException = (label: string) =>
    exceptions.set(label, (exceptions.get(label) || 0) + 1);
  group.facilities.forEach((facility) => {
    const status = facilityState(game, facility, limits.get(facility.id) ?? 1);
    if (status.exception) addException(status.exception);
    if (
      facility.yearsToBuildLeft <= 0 &&
      facilityReservoirReading(facility)?.low
    )
      addException("low reservoir");
  });
  const exceptionText = [...exceptions]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, count]) => `${count} ${label}`)
    .join(" · ");
  const fraction = group.storage
    ? peakWh
      ? storedWh / peakWh
      : 0
    : peakW
      ? outputW / peakW
      : 0;
  const percent = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  const reading = group.storage
    ? `${percent}% charged · ${formatWattHours(storedWh)} stored`
    : peakW
      ? `${formatWattsOfPeak(outputW, peakW)} output`
      : "0MW output";
  const flow = group.storage
    ? [
        outputW > 0 ? `Discharging ${formatWatts(outputW)}` : "",
        chargingW > 0 ? `Charging ${formatWatts(chargingW)}` : "",
      ].filter(Boolean)
    : [];
  const reservoir = reservoirCapacityWh
    ? `Reservoir ${Math.round((reservoirWh / reservoirCapacityWh) * 100)}%`
    : "";
  const icon =
    group.facilities[0].fuel === "Uranium"
      ? "nuclear"
      : group.name.toLowerCase();

  return (
    <button
      type="button"
      className="fleetGridNode"
      aria-label={`Inspect ${group.name} group, ${group.facilities.length} ${group.facilities.length === 1 ? "facility" : "facilities"}, ${reading}${flow.length ? `, ${flow.join(", ")}` : ""}${reservoir ? `, ${reservoir}` : ""}${exceptionText ? `, ${exceptionText}` : ""}`}
      aria-expanded={expanded}
      aria-controls="fleetGridInspection"
      onClick={onOpen}
    >
      <span className="fleetGridNodeHeading">
        <img src={`/images/${icon}.svg`} alt="" width="40" height="40" />
        <span className="fleetGridName">
          {group.name}{" "}
          <span className="fleetGridCount">×{group.facilities.length}</span>
        </span>
      </span>
      {group.storage && (
        <span className="fleetGridFlow">
          {flow.length ? (
            flow.map((text) => (
              <span key={text}>
                {text.startsWith("Charging") ? "↓" : "↑"} {text}
              </span>
            ))
          ) : (
            <span>Standby</span>
          )}
        </span>
      )}
      <span className="fleetGridReading">{reading}</span>
      {reservoir && <span className="fleetGridStored">{reservoir}</span>}
      {exceptionText && (
        <span
          className={`fleetGridExceptions${exceptions.has("low reservoir") ? " fleetGridReservoirLow" : ""}`}
        >
          {exceptionText}
        </span>
      )}
      {!!operating.length && (
        <span
          className="fleetGridMeter"
          role="meter"
          aria-label={`${group.name} ${group.storage ? "charge" : "output"}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={`${percent}% ${group.storage ? "charge" : "of rated output"}`}
        >
          <span style={{ width: `${percent}%` }} />
        </span>
      )}
    </button>
  );
}

/** Shared power balance and technology groups; dispatch order remains in Dispatch. */
export default function FleetGrid({
  game,
  selectedFacilityId,
  onSelect,
  onInspectInterties,
  children,
}: Props) {
  const [openGroup, setOpenGroup] = React.useState<string | null>(null);
  const inspection = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (openGroup) inspection.current?.scrollIntoView?.({ block: "nearest" });
  }, [openGroup]);
  const now = currentTick(game);
  if (!now) return null;
  const groups = groupFacilities(game.facilities);
  const selectedGroup = groups.find((group) =>
    group.facilities.some((facility) => facility.id === selectedFacilityId),
  );
  const inspecting =
    selectedGroup || groups.find((group) => group.key === openGroup);
  const effects = combineStoryEffects(
    game.worldEvents.active.filter(
      (event) =>
        game.date.minute >= event.startsMinute &&
        game.date.minute < event.endsMinute,
    ),
  );
  const limits = new Map(
    game.facilities.map((facility) => [
      facility.id,
      storyOutputMultiplier(facility, effects),
    ]),
  );
  const shortageW = Math.max(0, now.demandW - now.supplyW);
  const lines = game.transmission?.lines || [];
  const operatingLines = lines.filter((line) => line.yearsToBuildLeft <= 0);
  const importingW = operatingLines.reduce(
    (sum, line) => sum + Math.max(0, line.currentFlowW),
    0,
  );
  const exportingW = operatingLines.reduce(
    (sum, line) => sum + Math.max(0, -line.currentFlowW),
    0,
  );
  const buildingLines = lines.filter(
    (line) => line.yearsToBuildLeft > 0,
  ).length;
  const pausedLines = operatingLines.filter((line) => line.paused).length;
  const renderGroup = (group: FacilityGroup) => (
    <GroupNode
      key={group.key}
      group={group}
      game={game}
      limits={limits}
      expanded={inspecting?.key === group.key}
      onOpen={() => {
        const closing = inspecting?.key === group.key;
        setOpenGroup(closing ? null : group.key);
        onSelect(
          !closing && group.facilities.length === 1
            ? group.facilities[0].id
            : null,
        );
      }}
    />
  );
  const closeGroup = () => {
    inspection.current
      ?.closest(".fleetGrid")
      ?.querySelector<HTMLButtonElement>('.fleetGridNode[aria-expanded="true"]')
      ?.focus();
    setOpenGroup(null);
    onSelect(null);
  };

  return (
    <section className="fleetGrid" aria-label="Live power grid">
      <div
        className={`fleetGridBalance${shortageW > 0 ? " fleetGridShortage" : ""}`}
        aria-label="Current power balance"
      >
        <div>
          <strong>Customers</strong>
          <span>{formatWatts(now.demandW)} demand now</span>
        </div>
        <div className="fleetGridDelivery">
          <strong>
            {shortageW > 0
              ? `${formatWatts(shortageW)} short`
              : "Fully supplied"}
          </strong>
          <span>{formatWatts(now.supplyW)} grid supply</span>
        </div>
      </div>
      <div className="fleetGridDiagram">
        <div
          className="fleetGridGenerators"
          aria-label="Generation feeding the grid"
        >
          {groups.filter((group) => !group.storage).map(renderGroup)}
        </div>
        <div className="fleetGridBus">
          <span aria-hidden="true">↓</span>
          <strong>Grid</strong>
          <span aria-hidden="true">→</span>
          <span>Customers</span>
        </div>
        <div
          className="fleetGridSupport"
          aria-label="Storage and intertie flows"
        >
          {groups.filter((group) => group.storage).map(renderGroup)}
          {!!lines.length && (
            <button
              type="button"
              className="fleetGridInterties"
              onClick={onInspectInterties}
              aria-label="Inspect interties and trading policy"
            >
              <span className="fleetGridNodeHeading">
                <ConceptIcon concept="reorder" aria-hidden />
                <strong>
                  Interties{" "}
                  <span className="fleetGridCount">×{lines.length}</span>
                </strong>
              </span>
              {importingW > 0 && (
                <span>↑ Importing {formatWatts(importingW)}</span>
              )}
              {exportingW > 0 && (
                <span>↓ Exporting {formatWatts(exportingW)}</span>
              )}
              {!importingW && !exportingW && (
                <span className="fleetGridStored">No power flowing</span>
              )}
              {!!buildingLines && (
                <span className="fleetGridExceptions">
                  {buildingLines} building
                </span>
              )}
              {!!pausedLines && (
                <span className="fleetGridExceptions">
                  {pausedLines} paused
                </span>
              )}
            </button>
          )}
        </div>
      </div>
      <p className="fleetGridHint">Select a group to inspect its facilities.</p>
      <div
        id="fleetGridInspection"
        className="fleetGridInspection"
        ref={inspection}
      >
        {inspecting && (
          <>
            <div className="fleetGridInspectionHeading">
              <strong>
                {inspecting.name} · {inspecting.facilities.length}{" "}
                {inspecting.facilities.length === 1 ? "facility" : "facilities"}
              </strong>
              <button
                type="button"
                onClick={closeGroup}
                aria-label="Close facility group"
              >
                Close
              </button>
            </div>
            {inspecting.facilities.length > 1 && (
              <div className="fleetGridMembers">
                {[...inspecting.facilities]
                  .sort((a, b) => a.id - b.id)
                  .map((facility) => {
                    const status = facilityState(
                      game,
                      facility,
                      limits.get(facility.id) ?? 1,
                    );
                    const reservoir =
                      facility.yearsToBuildLeft <= 0
                        ? facilityReservoirReading(facility)
                        : undefined;
                    const label = `${facility.name} #${facility.id} · ${formatFacilitySize(facility)}`;
                    const reading = `${status.text}${!isStorage(facility) && facility.yearsToBuildLeft <= 0 ? ` · ${formatWatts(facility.currentW)} output` : ""}`;
                    return (
                      <button
                        type="button"
                        key={facility.id}
                        className="fleetGridMember"
                        aria-label={`Inspect ${label}, ${reading}${reservoir ? `, reservoir ${reservoir.percent}%${reservoir.low ? " low" : ""}` : ""}`}
                        aria-pressed={selectedFacilityId === facility.id}
                        onClick={() => {
                          setOpenGroup(inspecting.key);
                          onSelect(
                            selectedFacilityId === facility.id
                              ? null
                              : facility.id,
                          );
                        }}
                      >
                        <span>{label}</span>
                        <span
                          className={
                            status.exception || reservoir?.low
                              ? "fleetGridExceptions"
                              : "fleetGridStored"
                          }
                        >
                          {reading}
                          {reservoir
                            ? ` · Reservoir ${reservoir.percent}%${reservoir.low ? " low" : ""}`
                            : ""}
                        </span>
                      </button>
                    );
                  })}
              </div>
            )}
            {selectedGroup?.key === inspecting.key && children}
          </>
        )}
      </div>
    </section>
  );
}
