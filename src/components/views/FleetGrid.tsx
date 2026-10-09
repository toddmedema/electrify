import * as React from "react";
import { FacilityOperatingType, GameType, isStorage } from "../../Types";
import { currentTick } from "../../helpers/GameSelectors";
import {
  formatWatts,
  formatWattHours,
  formatWattsOfPeak,
} from "../../helpers/Format";
import { facilityHazardStatus, isUpgradingAt } from "../../helpers/Hazards";
import { combineStoryEffects } from "../../data/WorldEvents";
import { storyOutputMultiplier } from "../../helpers/Story";
import ConceptIcon from "../base/ConceptIcon";
import "./FleetGrid.scss";
import { facilityReservoirReading } from "../base/FacilityReservoir";
import { useFacilityFeedback } from "../base/FacilityFeedback";

interface Props {
  game: GameType;
  selectedFacilityId: number | null;
  onSelect: (id: number | null) => void;
  onInspectInterties: () => void;
}

function FacilityNode({
  game,
  facility,
  selected,
  onSelect,
  outputLimit,
}: {
  game: GameType;
  facility: FacilityOperatingType;
  selected: boolean;
  onSelect: Props["onSelect"];
  outputLimit: number;
}) {
  const storage = isStorage(facility);
  const feedback = useFacilityFeedback();
  const milestone = feedback.milestones[facility.id];
  const arriving = feedback.arrivingFacilityId === facility.id;
  const building = facility.yearsToBuildLeft > 0;
  const upgrading = isUpgradingAt(facility, game.date.minute);
  const hazard = facilityHazardStatus(game, facility);
  const reservoir =
    !building && !storage ? facilityReservoirReading(facility) : undefined;
  const icon =
    facility.fuel === "Uranium" ? "nuclear" : facility.name.toLowerCase();
  const charge = storage
    ? Math.round((facility.currentWh / facility.peakWh) * 100)
    : 0;
  const fraction = building
    ? 1 - facility.yearsToBuildLeft / facility.yearsToBuild
    : storage
      ? facility.currentWh / facility.peakWh
      : Math.abs(facility.currentW) / facility.peakW;
  const state = building
    ? `Building · ${Math.ceil(facility.yearsToBuildLeft * 12)} months left`
    : upgrading
      ? "Offline for upgrade"
      : facility.paused
        ? "Paused"
        : hazard
          ? `${hazard.label} · ${Math.round(hazard.availableFraction * 100)}% available`
          : outputLimit < 1
            ? outputLimit === 0
              ? "Unavailable"
              : `Limited · ${Math.round(outputLimit * 100)}% capacity`
            : storage
              ? facility.currentW < 0
                ? `Charging · ${formatWatts(-facility.currentW)}`
                : facility.currentW > 0
                  ? `Supplying · ${formatWatts(facility.currentW)}`
                  : "Standby"
              : facility.currentW > 0
                ? "Supplying"
                : "Idle";
  const reading = building
    ? `${Math.round(Math.max(0, fraction) * 100)}% built`
    : storage
      ? `${charge}% charged`
      : `${formatWattsOfPeak(facility.currentW, facility.peakW)} output`;
  const meterPercent = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  const meterLabel = building
    ? "construction progress"
    : storage
      ? "charge"
      : "output";

  return (
    <button
      type="button"
      className={`fleetGridNode${milestone ? " fleetGridMilestone" : ""}${arriving ? " facilityArrival" : ""}`}
      aria-label={`Inspect ${facility.name} in grid, ${reading}, ${state}${milestone ? `, ${milestone}` : ""}${reservoir ? `, reservoir ${reservoir.percent}%${reservoir.low ? " low" : ""}` : ""}`}
      aria-pressed={selected}
      onClick={() => onSelect(selected ? null : facility.id)}
    >
      <img src={`/images/${icon}.svg`} alt="" width="48" height="48" />
      <span className="fleetGridName">{facility.name}</span>
      <span className="fleetGridReading">{reading}</span>
      <span
        className={`fleetGridState${(hazard || outputLimit < 1) && !building && !upgrading && !facility.paused ? " fleetGridWarning" : ""}`}
      >
        {milestone && (
          <strong className="fleetGridMilestoneLabel">{milestone} · </strong>
        )}
        {state}
      </span>
      {storage && !building && (
        <span className="fleetGridStored">
          {formatWattHours(facility.currentWh)} stored
        </span>
      )}
      {reservoir && (
        <span
          className={`fleetGridStored${reservoir.low ? " fleetGridReservoirLow" : ""}`}
        >
          Reservoir {reservoir.percent}%{reservoir.low ? " · Low" : ""}
        </span>
      )}
      <span
        className="fleetGridMeter"
        role="meter"
        aria-label={`${facility.name} ${meterLabel}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={meterPercent}
        aria-valuetext={`${meterPercent}% ${meterLabel}`}
      >
        <span
          style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}
        />
      </span>
    </button>
  );
}

/** A schematic of the aggregate grid, not a geographic map or a new dispatch model. */
export default function FleetGrid({
  game,
  selectedFacilityId,
  onSelect,
  onInspectInterties,
}: Props) {
  const now = currentTick(game);
  if (!now) return null;
  const shortageW = Math.max(0, now.demandW - now.supplyW);
  const rows: FacilityOperatingType[][] = [];
  for (let i = 0; i < game.facilities.length; i += 2) {
    rows.push(game.facilities.slice(i, i + 2));
  }
  const lines = game.transmission?.lines || [];
  const effects = combineStoryEffects(
    game.worldEvents.active.filter(
      (event) =>
        game.date.minute >= event.startsMinute &&
        game.date.minute < event.endsMinute,
    ),
  );

  return (
    <section className="fleetGrid" aria-label="Live power grid">
      <p className="fleetGridHint">Select a facility to inspect.</p>
      <div className="fleetGridDiagram">
        {rows.map((row) => (
          <div className="fleetGridRow" key={row[0].id}>
            {row.map((facility) => (
              <FacilityNode
                key={facility.id}
                game={game}
                facility={facility}
                selected={selectedFacilityId === facility.id}
                onSelect={onSelect}
                outputLimit={storyOutputMultiplier(facility, effects)}
              />
            ))}
          </div>
        ))}
        {!!lines.length && (
          <button
            type="button"
            className="fleetGridInterties"
            onClick={onInspectInterties}
            aria-label="Inspect interties and trading policy"
          >
            <ConceptIcon concept="reorder" aria-hidden />
            <span>
              <strong>Interties</strong>
              {lines.map((line) => (
                <span className="fleetGridIntertie" key={line.id}>
                  {line.name}
                  <span>
                    {line.yearsToBuildLeft > 0
                      ? `Building · ${Math.ceil(line.yearsToBuildLeft * 12)} months left`
                      : line.paused
                        ? "Paused"
                        : line.currentFlowW > 0
                          ? `Importing ${formatWatts(line.currentFlowW)}`
                          : line.currentFlowW < 0
                            ? `Exporting ${formatWatts(-line.currentFlowW)}`
                            : "No power flowing"}
                  </span>
                </span>
              ))}
            </span>
          </button>
        )}
        <div
          className={`fleetGridCustomers${shortageW > 0 ? " fleetGridShortage" : ""}`}
        >
          <ConceptIcon concept="customers" aria-hidden />
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
      </div>
    </section>
  );
}
