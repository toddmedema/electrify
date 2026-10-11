import * as React from "react";
import { FacilityOperatingType, GameType, isStorage } from "../../Types";
import { currentTick } from "../../helpers/GameSelectors";
import { formatWatts } from "../../helpers/Format";
import { facilityHazardStatus, isUpgradingAt } from "../../helpers/Hazards";
import { combineStoryEffects } from "../../data/WorldEvents";
import { storyOutputMultiplier } from "../../helpers/Story";
import { facilityColor } from "../../Theme";
import { facilityReservoirReading } from "../base/FacilityReservoir";
import { ChevronDownGlyph } from "../base/Glyphs";
import "./FleetGrid.scss";

interface Props {
  game: GameType;
  selectedFacilityId: number | null;
  onSelect: (id: number) => void;
  onInspectInterties: () => void;
  forecastOpen: boolean;
  onToggleForecast: () => void;
}
interface Exception {
  label: string;
  id: number;
  urgent: boolean;
}
interface FacilityGroup {
  name: string;
  facilities: FacilityOperatingType[];
  outputW: number;
  chargingW: number;
  storage: boolean;
  color: string;
}
const shortNames: Record<string, string> = {
  "Natural Gas CC": "Gas CC",
  "Natural Gas Peaker": "Gas peaker",
  "Enhanced Geothermal": "Enhanced geo",
  "Offshore Wind": "Offshore wind",
  "Airborne Wind": "Airborne wind",
};

function facilityExceptions(game: GameType): Exception[] {
  const effects = combineStoryEffects(
    game.worldEvents.active.filter(
      (event) =>
        game.date.minute >= event.startsMinute &&
        game.date.minute < event.endsMinute,
    ),
  );
  return game.facilities.flatMap((facility) => {
    if (facility.yearsToBuildLeft > 0)
      return [{ label: "building", id: facility.id, urgent: false }];
    const exceptions: Exception[] = [];
    const add = (label: string, urgent = false) =>
      exceptions.push({ label, id: facility.id, urgent });
    if (isUpgradingAt(facility, game.date.minute)) add("upgrading");
    else if (facility.paused) add("paused");
    else {
      const hazard = facilityHazardStatus(game, facility);
      const limit = storyOutputMultiplier(facility, effects);
      if (hazard) add(hazard.label.toLowerCase());
      else if (limit < 1)
        add(limit === 0 ? "unavailable" : "limited", limit === 0);
    }
    if (facilityReservoirReading(facility)?.low) add("low reservoir", true);
    return exceptions;
  });
}
function groupFacilities(facilities: FacilityOperatingType[]): FacilityGroup[] {
  const groups = new Map<string, FacilityGroup>();
  facilities.forEach((facility) => {
    let group = groups.get(facility.name);
    if (!group) {
      group = {
        name: facility.name,
        facilities: [],
        outputW: 0,
        chargingW: 0,
        storage: isStorage(facility),
        color: facilityColor(facility.fuel),
      };
      groups.set(facility.name, group);
    }
    group.facilities.push(facility);
    if (facility.yearsToBuildLeft <= 0) {
      group.outputW += Math.max(0, facility.currentW);
      if (isStorage(facility))
        group.chargingW += Math.max(0, -facility.currentW);
    }
  });
  return [...groups.values()].sort(
    (a, b) =>
      Number(a.storage) - Number(b.storage) || a.name.localeCompare(b.name),
  );
}

function FlowReading({ flows }: { flows: string[] }) {
  if (!flows.length) return <>Standby</>;
  return (
    <>
      {flows.map((flow, index) => (
        <React.Fragment key={flow}>
          {index > 0 && " "}
          <span className="fleetPowerFlowDirection">
            {index > 0 && "· "}
            {flow}
          </span>
        </React.Fragment>
      ))}
    </>
  );
}

/** A compact live overview above the individual, reorderable dispatch rows. */
export default function FleetGrid({
  game,
  selectedFacilityId,
  onSelect,
  onInspectInterties,
  forecastOpen,
  onToggleForecast,
}: Props) {
  const now = currentTick(game);
  if (!now) return null;
  const groups = groupFacilities(game.facilities);
  const exceptions = facilityExceptions(game);
  const exceptionGroups = [...new Set(exceptions.map(({ label }) => label))]
    .map((label) => ({
      label,
      members: exceptions.filter((exception) => exception.label === label),
    }))
    .sort(
      (a, b) =>
        Number(b.members[0].urgent) - Number(a.members[0].urgent) ||
        a.label.localeCompare(b.label),
    );
  const generationW = groups
    .filter((group) => !group.storage)
    .reduce((sum, group) => sum + group.outputW, 0);
  const shortageW = Math.max(0, now.demandW - now.supplyW);
  const lines = game.transmission?.lines || [];
  const commissionedLines = lines.filter((line) => line.yearsToBuildLeft <= 0);
  const importingW = commissionedLines.reduce(
    (sum, line) => sum + Math.max(0, line.currentFlowW),
    0,
  );
  const exportingW = commissionedLines.reduce(
    (sum, line) => sum + Math.max(0, -line.currentFlowW),
    0,
  );
  const buildingLines = lines.filter(
    (line) => line.yearsToBuildLeft > 0,
  ).length;
  const pausedLines = commissionedLines.filter((line) => line.paused).length;

  return (
    <section className="fleetPowerFlow" aria-label="Live power flow">
      <div className="fleetPowerFlowHeader">
        <div
          className="fleetPowerFlowBalance"
          aria-label="Current power balance"
        >
          <div className="fleetPowerFlowValues">
            <div>
              <span>Supply now</span>
              <strong>{formatWatts(now.supplyW)}</strong>
            </div>
            <span className="fleetPowerFlowArrow" aria-hidden="true">
              →
            </span>
            <div>
              <span>Demand now</span>
              <strong>{formatWatts(now.demandW)}</strong>
            </div>
          </div>
          {shortageW > 0 && (
            <span className="fleetPowerFlowShortage">
              {formatWatts(shortageW)} short
            </span>
          )}
        </div>
        <button
          type="button"
          className="fleetPowerFlowForecast"
          aria-expanded={forecastOpen}
          aria-controls="facilityForecast"
          onClick={onToggleForecast}
        >
          Forecast{" "}
          <ChevronDownGlyph className={forecastOpen ? "expanded" : ""} />
        </button>
      </div>
      <div
        className="fleetPowerFlowMix"
        role="img"
        aria-label={
          "Generation mix: " +
          groups
            .filter((group) => !group.storage)
            .map((group) => group.name + " " + formatWatts(group.outputW))
            .join(", ")
        }
      >
        {groups
          .filter((group) => !group.storage && group.outputW > 0)
          .map((group) => (
            <span
              key={group.name}
              style={{
                width: (group.outputW / generationW) * 100 + "%",
                background: group.color,
              }}
            />
          ))}
      </div>
      <div className="fleetPowerFlowSources" aria-label="Sources and storage">
        {groups.map((group) => {
          const affected =
            group.facilities.find((facility) =>
              exceptions.some(
                (exception) => exception.id === facility.id && exception.urgent,
              ),
            ) ||
            group.facilities.find((facility) =>
              exceptions.some((exception) => exception.id === facility.id),
            );
          const target = affected || group.facilities[0];
          const reading = group.storage ? (
            <FlowReading
              flows={[
                group.outputW > 0 ? formatWatts(group.outputW) + " out" : "",
                group.chargingW > 0 ? formatWatts(group.chargingW) + " in" : "",
              ].filter(Boolean)}
            />
          ) : (
            formatWatts(group.outputW)
          );
          const accessibleFlow = group.storage
            ? "discharging " +
              formatWatts(group.outputW) +
              ", charging " +
              formatWatts(group.chargingW)
            : formatWatts(group.outputW) + " output";
          return (
            <button
              type="button"
              className="fleetPowerFlowSource"
              key={group.name}
              aria-label={
                "Inspect " +
                group.name +
                " group, " +
                group.facilities.length +
                (group.facilities.length === 1
                  ? " facility, "
                  : " facilities, ") +
                accessibleFlow
              }
              aria-pressed={group.facilities.some(
                (facility) => facility.id === selectedFacilityId,
              )}
              onClick={() => onSelect(target.id)}
              title={group.name + ": " + accessibleFlow}
            >
              <span className="fleetPowerFlowSourceName">
                <span
                  className="fleetPowerFlowDot"
                  style={{ background: group.color }}
                  aria-hidden="true"
                />
                {shortNames[group.name] || group.name}
                <span className="fleetPowerFlowCount">
                  ×{group.facilities.length}
                </span>
              </span>
              <span className="fleetPowerFlowSourceReading">{reading}</span>
            </button>
          );
        })}
        {!!lines.length && (
          <button
            type="button"
            className="fleetPowerFlowSource"
            onClick={onInspectInterties}
            aria-label={
              "Inspect interties and trading policy, importing " +
              formatWatts(importingW) +
              ", exporting " +
              formatWatts(exportingW) +
              (buildingLines ? ", " + buildingLines + " building" : "") +
              (pausedLines ? ", " + pausedLines + " paused" : "")
            }
          >
            <span className="fleetPowerFlowSourceName">
              Interties{" "}
              <span className="fleetPowerFlowCount">×{lines.length}</span>
            </span>
            <span className="fleetPowerFlowSourceReading">
              <FlowReading
                flows={[
                  importingW > 0 ? formatWatts(importingW) + " in" : "",
                  exportingW > 0 ? formatWatts(exportingW) + " out" : "",
                ].filter(Boolean)}
              />
            </span>
          </button>
        )}
      </div>
      {!!(exceptionGroups.length || buildingLines || pausedLines) && (
        <div
          className="fleetPowerFlowExceptions"
          aria-label="Facility exceptions"
        >
          {exceptionGroups.map(({ label, members }) => (
            <button
              type="button"
              key={label}
              className={members[0].urgent ? "urgent" : ""}
              aria-label={
                "Inspect " +
                members.length +
                " " +
                label +
                (members.length === 1 ? " facility" : " facilities")
              }
              onClick={() => onSelect(members[0].id)}
            >
              {members.length} {label}
            </button>
          ))}
          {!!buildingLines && (
            <button type="button" onClick={onInspectInterties}>
              {buildingLines} intertie building
            </button>
          )}
          {!!pausedLines && (
            <button type="button" onClick={onInspectInterties}>
              {pausedLines} intertie paused
            </button>
          )}
        </div>
      )}
    </section>
  );
}
