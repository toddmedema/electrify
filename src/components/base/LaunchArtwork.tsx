import "./LaunchArtwork.scss";

/** Decorative launch artwork. Live system state belongs in the game’s fleet view. */
export function TitleArtwork(): React.JSX.Element {
  return (
    <div className="titleArtwork" aria-hidden="true">
      <img src="/images/power-system.svg" alt="" />
    </div>
  );
}

/** Keep the authored mission icon as the identifying feature of every briefing. */
export function ScenarioArtwork(props: {
  icon: string;
  name: string;
}): React.JSX.Element {
  return (
    <div className="scenarioArtwork">
      <img
        className="scenarioDossierIcon"
        src={`/images/${props.icon.toLowerCase()}.svg`}
        alt={`${props.name} icon`}
      />
      <img
        className="scenarioArtworkWorld"
        src="/images/power-system.svg"
        alt=""
        aria-hidden="true"
      />
    </div>
  );
}
