import * as React from "react";
import { ScenarioFacilityType, ScenarioType } from "../../Types";

export interface ScenarioArtworkProps {
  scenario: ScenarioType;
  compact?: boolean;
}

function facilityImageName(facility: ScenarioFacilityType): string | undefined {
  return facility.fuel || facility.name;
}

/**
 * A reusable, data-driven scenario postcard. It deliberately uses the shipped facility drawings
 * rather than a one-off image so a new scenario only needs copy, a tone and its real starting
 * fleet to gain a coherent piece of art.
 */
export default function ScenarioArtwork({
  scenario,
  compact = false,
}: ScenarioArtworkProps): React.JSX.Element {
  const fleet = Array.from(
    new Set(
      scenario.facilities
        .map(facilityImageName)
        .filter((name): name is string => Boolean(name)),
    ),
  ).slice(0, compact ? 3 : 5);
  const tone = scenario.briefing?.tone || "transition";
  const fleetLabel = fleet.length > 0 ? fleet.join(", ") : scenario.icon;

  return (
    <div
      className={`scenarioArtwork tone-${tone}${compact ? " compact" : ""}`}
      role="img"
      aria-label={`${scenario.name} starting grid: ${fleetLabel}`}
    >
      <div className="scenarioArtworkSun" aria-hidden />
      <div className="scenarioArtworkGrid" aria-hidden />
      <img
        className="scenarioArtworkMark"
        src={`/images/${scenario.icon.toLowerCase()}.svg`}
        alt=""
        aria-hidden
      />
      <div className="scenarioArtworkFleet" aria-hidden>
        {fleet.map((name) => (
          <img key={name} src={`/images/${name.toLowerCase()}.svg`} alt="" />
        ))}
      </div>
    </div>
  );
}
