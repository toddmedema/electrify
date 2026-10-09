import "./LaunchArtwork.scss";
import { ScenarioType } from "../../Types";

/** Decorative launch artwork. Live system state belongs in the game’s fleet view. */
export function TitleArtwork(): React.JSX.Element {
  return (
    <div className="titleArtwork" aria-hidden="true">
      <img src="/images/power-system.svg" width={1200} height={360} alt="" />
    </div>
  );
}

/** Keep the authored mission icon as the identifying feature of every briefing. */
export function ScenarioArtwork(props: {
  scenario: Pick<ScenarioType, "icon" | "name" | "themes">;
}): React.JSX.Element {
  const { icon, name, themes } = props.scenario;
  // Freeze has its own concrete threat; do not paint hurricanes or drought as winter storms.
  // Growth and transition follow the authored browse families, including multi-theme missions.
  const scene =
    icon.toLowerCase() === "texas deep freeze"
      ? "power-system-freeze"
      : themes?.includes("Rapid growth")
        ? "power-system-growth"
        : themes?.includes("Energy transition")
          ? "power-system-transition"
          : "power-system";
  return (
    <div className="scenarioArtwork">
      <img
        className="scenarioDossierIcon"
        src={`/images/${icon.toLowerCase()}.svg`}
        alt={`${name} icon`}
      />
      <img
        className="scenarioArtworkWorld"
        src={`/images/${scene}.svg`}
        width={1200}
        height={360}
        alt=""
        aria-hidden="true"
      />
    </div>
  );
}
