import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { difficultyLockReason } from "../../achievements/DifficultyUnlocks";
import { activeScenario } from "../../helpers/GameSelectors";
import * as React from "react";
import { Button, Typography } from "@mui/material";
import ScreenPage from "../base/ScreenPage";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import PlayCircleIcon from "@mui/icons-material/PlayCircleOutlined";
import VictoryConditionsDialog from "../base/VictoryConditionsDialog";
import ConceptIcon from "../base/ConceptIcon";
import { DIFFICULTY_LABELS, MONTHS } from "../../Constants";
import DifficultyPicker from "../base/DifficultyPicker";
import { getScenario } from "../../data/Scenarios";
import { getScenarioLocation } from "../../helpers/Locations";
import { prefetchScenarioData } from "../../helpers/OfflineData";
import CoopBrowseBar, { CoopStartButton } from "../base/CoopBrowseBar";
import {
  ChallengeInvitation,
  CoopSelectionType,
  DifficultyType,
  GameType,
  LocationType,
  ScenarioType,
} from "../../Types";

import { formatScore } from "../../helpers/Format";
import { reliabilityRuleText } from "../../helpers/ObjectiveRules";
import ScenarioLeaderboard from "../base/ScenarioLeaderboard";

export interface StateProps {
  challenge?: ChallengeInvitation;
  onContinue?: () => void;
  game: GameType;
  unlockedThrough?: DifficultyType;
  uid?: string;
  /** Choosing with a co-op lobby: the host starts for everyone; guests mark Ready. */
  coop?: CoopSelectionType;
}

export interface DispatchProps {
  onBack: () => void;
  onDelta: (delta: Partial<GameType>) => void;
  onStart: (scenarioId: number) => void;
}

interface State {
  scenario: ScenarioType | null;
  location: LocationType | null;
  victoryDialogOpen?: boolean;
}

export interface Props extends StateProps, DispatchProps {}

export default class NewGameDetails extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    const scenario = activeScenario(props.game) || null;
    this.state = { scenario, location: getScenarioLocation(scenario) || null };
  }

  public componentDidMount() {
    if (this.state.location) void prefetchScenarioData(this.state.location);
  }

  public componentDidUpdate(prevProps: Props) {
    if (this.props.game.scenarioId !== prevProps.game.scenarioId) {
      const scenario =
        getScenario(
          this.props.game.scenarioId,
          this.props.game.customScenario,
        ) || null;
      this.setState({
        scenario,
        location: getScenarioLocation(scenario) || null,
      });
    }
  }

  public render() {
    const { onBack, onDelta, onStart, game, uid, challenge, onContinue, coop } =
      this.props;
    const { scenario, location, victoryDialogOpen } = this.state;

    const toggleVictoryDialog = (e: React.SyntheticEvent) => {
      this.setState({ victoryDialogOpen: !victoryDialogOpen });
      e.stopPropagation();
    };

    if (!scenario || !location) {
      return (
        <ScreenPage title="Unknown scenario or location" onBack={onBack} />
      );
    }

    const challengeLock =
      challenge && this.props.unlockedThrough
        ? difficultyLockReason(game.difficulty, this.props.unlockedThrough)
        : undefined;
    const endYear =
      scenario.startingYear +
      Math.floor(
        ((scenario.startingMonth ?? 1) - 1 + scenario.durationMonths - 1) / 12,
      );
    return (
      <ScreenPage
        id="listCard"
        title={challenge ? "Friend challenge" : "Game details"}
        titleComponent="div"
        onBack={onBack}
      >
        <CoopBrowseBar coop={coop} />
        <div className="scrollable">
          <section className="scenarioDossier" aria-labelledby="scenario-title">
            <img
              className="scenarioDossierIcon"
              src={`/images/${scenario.icon.toLowerCase()}.svg`}
              alt={`${scenario.name} icon`}
            />
            <div className="scenarioDossierCopy">
              <Typography
                id="scenario-title"
                variant="h6"
                component="h1"
                sx={{ fontWeight: 600, lineHeight: 1.2 }}
              >
                {scenario.name}
              </Typography>
              <Typography variant="overline" component="div">
                {location.name} ·{" "}
                {scenario.startingMonth
                  ? `${MONTHS[scenario.startingMonth - 1]} `
                  : ""}
                {scenario.startingYear}–
                {scenario.startingMonth
                  ? `${MONTHS[(scenario.startingMonth - 1 + scenario.durationMonths - 1) % 12]} `
                  : ""}
                {endYear}
              </Typography>
              {scenario.summary && (
                <Typography variant="body1" color="textSecondary">
                  {scenario.summary}
                </Typography>
              )}
              <div className="scenarioBriefing">
                <Button
                  startIcon={<InfoOutlinedIcon />}
                  onClick={toggleVictoryDialog}
                >
                  Goals and scoring
                </Button>
                {scenario.threat && (
                  <div className="scenarioWatchOut" role="note">
                    <ConceptIcon concept="danger" fontSize="small" />
                    <div>
                      <Typography variant="overline" component="div">
                        Watch out
                      </Typography>
                      <Typography variant="body2">{scenario.threat}</Typography>
                    </div>
                  </div>
                )}
              </div>
              <div className="scenarioStartControls">
                {challenge ? (
                  <div className="difficultyPicker">
                    <Typography variant="body1">
                      <strong>
                        Friend’s score: {formatScore(challenge.target)}
                      </strong>
                    </Typography>
                    <Typography variant="body2">
                      {DIFFICULTY_LABELS[game.difficulty]}
                    </Typography>
                  </div>
                ) : (
                  <div className="difficultyPicker">
                    <DifficultyPicker
                      scenario={scenario}
                      variant="toggle"
                      showDescription
                      value={game.difficulty}
                      onChange={(difficulty) => onDelta({ difficulty })}
                      readOnly={coop?.role === "guest"}
                      unlockedThrough={this.props.unlockedThrough}
                    />
                  </div>
                )}
                {challengeLock && (
                  <Typography
                    role="status"
                    variant="body2"
                    color="text.secondary"
                  >
                    <LockOutlinedIcon
                      fontSize="small"
                      sx={{ verticalAlign: "middle", mr: 0.5 }}
                    />
                    {challengeLock}
                  </Typography>
                )}
                {this.props.challenge && (
                  <Typography variant="body2" color="text.secondary">
                    {reliabilityRuleText(game.difficulty, scenario)}
                  </Typography>
                )}
                {coop ? (
                  <CoopStartButton
                    className="scenarioStartButton"
                    coop={coop}
                    onStart={() => onStart(scenario.id)}
                  />
                ) : (
                  <Button
                    className="scenarioStartButton"
                    size="large"
                    variant="contained"
                    color="primary"
                    onClick={() => onStart(scenario.id)}
                    disabled={!!challengeLock}
                    startIcon={
                      challengeLock ? <LockOutlinedIcon /> : <PlayCircleIcon />
                    }
                  >
                    {challenge ? "Start challenge" : "Start game"}
                  </Button>
                )}
              </div>
              {onContinue && !coop && (
                <Button onClick={onContinue}>Continue saved game</Button>
              )}
            </div>
          </section>

          <VictoryConditionsDialog
            open={victoryDialogOpen || false}
            onClose={() => this.setState({ victoryDialogOpen: false })}
            title="Goals"
            scenario={scenario}
            difficulty={game.difficulty}
          />

          {!challenge && !coop && (
            <ScenarioLeaderboard
              scenarioId={scenario.id}
              difficulty={game.difficulty}
              uid={uid}
            />
          )}
        </div>
      </ScreenPage>
    );
  }
}
