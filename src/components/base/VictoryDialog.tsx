import * as React from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import ShareIcon from "@mui/icons-material/Share";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import numbro from "numbro";
import { VictoryType } from "../../Types";
import { fetchGlobalRank } from "../../reducers/User";
import {
  buildScoreShareContent,
  canShare,
  shareText,
} from "../../helpers/Share";
import ConceptIcon, { ConceptNameType } from "./ConceptIcon";
import InstallAppButton from "./InstallAppButton";

// What each scored category is called on the score screen. The breakdown's keys differ by
// ownership (see reducers/Game), so this is a lookup rather than a fixed list -- a scenario type
// with new categories shows up here as soon as it scores them, in the order they were scored.
export const SCORE_LABELS: { [key: string]: string } = {
  supply: "electricity supplied",
  netWorth: "final net worth",
  customers: "final customers",
  rate: "electric rates",
  emissions: "emissions",
  blackouts: "blackouts",
};

const SCORE_CONCEPTS: { [key: string]: ConceptNameType | undefined } = {
  supply: "supply",
  netWorth: "money",
  customers: "customers",
  rate: "money",
  emissions: "danger",
  blackouts: "blackout",
};

export interface StateProps {
  victory: VictoryType | null;
  loggedIn: boolean;
}

export interface DispatchProps {
  onClose: () => void;
  onQuit: () => void;
  onRetry: (victory: VictoryType) => void;
  onLogin: () => void;
  // Reported once the player has actually shared, with how it went out
  onShared: (victory: VictoryType, method: string) => void;
  onShareFailed: () => void;
}

export interface Props extends StateProps, DispatchProps {}

export function formatScore(score: number): string {
  return numbro(score).format({ thousandSeparated: true, mantissa: 0 });
}

/**
 * The end of a run: the score breakdown, how it compares to the player's own best, where it lands
 * on the global board, and a way to tell someone about it.
 *
 * The breakdown renders the moment the dialog opens and never waits on anything. The rank is a
 * network read and the personal best depends on being logged in, so both are enrichment that
 * appears when (and if) it can -- a Firestore hiccup must not cost the player their score screen.
 */
export default function VictoryDialog(props: Props): React.JSX.Element {
  const { victory, loggedIn, onClose, onQuit, onLogin } = props;
  const [rank, setRank] = React.useState<number | undefined>(undefined);
  const [rankFailed, setRankFailed] = React.useState(false);

  // Identity rather than the object, so re-renders while the dialog is open don't refetch
  const scenarioId = victory?.scenarioId;
  const score = victory?.score;
  const ranked = Boolean(victory?.ranked);

  React.useEffect(() => {
    if (scenarioId === undefined || score === undefined || !ranked) {
      return;
    }
    setRank(undefined);
    setRankFailed(false);
    // Guarded rather than cancelled: an aggregate read that lands after the player has closed the
    // dialog must not set state on an unmounted tree
    let live = true;
    fetchGlobalRank(scenarioId, score)
      .then((position) => {
        if (live) {
          setRank(position);
        }
      })
      .catch((err) => {
        console.warn("Couldn't work out your rank: ", err);
        if (live) {
          setRankFailed(true);
        }
      });
    return () => {
      live = false;
    };
  }, [scenarioId, score, ranked]);

  if (!victory) {
    // Rendered closed rather than not at all, so MUI can animate the dialog out
    return <Dialog open={false} />;
  }

  const { previousBest, breakdown, endTitle, endMessage } = victory;
  const failed = victory.outcome === "bankrupt" || victory.outcome === "fired";
  const isPersonalBest =
    previousBest === undefined || victory.score > previousBest;
  let displayTitle =
    endTitle ||
    (victory.outcome === "bankrupt"
      ? "Bankrupt!"
      : victory.outcome === "fired"
        ? "Fired!"
        : `You've retired!`);
  if (!failed && endTitle && /^mission complete!?$/i.test(endTitle.trim())) {
    displayTitle = victory.scenarioName;
  }

  const onShare = () => {
    const content = buildScoreShareContent({
      scenarioId: victory.scenarioId,
      score: victory.score,
      scenarioName: victory.scenarioName,
      difficulty: victory.difficulty,
    });
    shareText(content).then((method) => {
      if (method === "cancelled") {
        return; // The player changed their mind, which is not a failure to report
      }
      if (method === "unavailable") {
        props.onShareFailed();
        return;
      }
      props.onShared(victory, method);
    });
  };

  return (
    <Dialog
      open={true}
      // The run is over either way; dismissing by backdrop or Esc is the same as "Keep playing"
      // only after a completed term. A failed run is terminal and would fail and submit again on
      // the next month if it could resume.
      onClose={failed ? undefined : onClose}
      aria-labelledby="victory-title"
      fullWidth
      maxWidth="sm"
      slotProps={{
        paper: {
          sx: {
            overflow: "hidden",
            backgroundImage: failed
              ? "radial-gradient(circle at 50% -20%, rgba(211, 47, 47, 0.2), transparent 45%)"
              : "radial-gradient(circle at 50% -20%, rgba(255, 193, 7, 0.28), transparent 45%)",
          },
        },
      }}
    >
      <DialogTitle id="victory-title" sx={{ pb: 1.5 }}>
        <Stack spacing={0.5} sx={{ alignItems: "center", textAlign: "center" }}>
          {failed ? (
            <ReportProblemOutlinedIcon
              color="error"
              sx={{ fontSize: 52 }}
              aria-hidden
            />
          ) : (
            <EmojiEventsIcon
              color="warning"
              sx={{ fontSize: 52 }}
              aria-hidden
            />
          )}
          <Typography
            variant="overline"
            color={failed ? "error.main" : "warning.main"}
            sx={{ fontWeight: 800, letterSpacing: "0.14em" }}
          >
            {failed ? "Run ended" : "Mission complete"}
          </Typography>
          <Typography variant="h5" component="span" sx={{ fontWeight: 800 }}>
            {displayTitle}
          </Typography>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ px: { xs: 2, sm: 3 } }}>
        {endMessage && (
          <Typography variant="body1" gutterBottom sx={{ textAlign: "center" }}>
            {endMessage}
          </Typography>
        )}
        <Typography variant="body1" sx={{ fontWeight: 600 }}>
          Final score: <strong>{formatScore(victory.score)}</strong>
        </Typography>
        <div style={{ margin: "8px 0" }}>
          {Object.keys(breakdown).map((category: string) => {
            const concept = SCORE_CONCEPTS[category];
            return (
              <div key={category} className="scoreBreakdownRow">
                {concept && <ConceptIcon concept={concept} fontSize="small" />}
                {breakdown[category]} pts from{" "}
                {SCORE_LABELS[category] || category}
              </div>
            );
          })}
        </div>
        {ranked && loggedIn && (
          <Typography variant="body1" style={{ marginTop: 12 }}>
            {isPersonalBest ? (
              <strong>
                New personal best
                {previousBest !== undefined
                  ? ` - was ${formatScore(previousBest)}`
                  : ""}
              </strong>
            ) : (
              <span>Your best: {formatScore(previousBest as number)}</span>
            )}
          </Typography>
        )}
        {ranked && !rankFailed && (
          <Typography variant="body1" component="div">
            {rank === undefined ? (
              <Skeleton width={200} aria-label="Working out your rank" />
            ) : (
              <span>
                <strong>#{formatScore(rank)}</strong> on the global leaderboard
              </span>
            )}
          </Typography>
        )}
        {ranked && !loggedIn && (
          <Typography variant="body2" color="textSecondary" component="div">
            <Button
              color="primary"
              onClick={onLogin}
              style={{ paddingLeft: 0 }}
            >
              Log in
            </Button>
            to put this score on the board under your name
          </Typography>
        )}
      </DialogContent>
      <DialogActions
        sx={{
          px: { xs: 2, sm: 3 },
          pb: 2,
          flexWrap: "wrap",
          gap: 0.5,
          "& > :not(:first-of-type)": { ml: 0 },
        }}
      >
        {canShare() && (
          <Button color="primary" onClick={onShare} startIcon={<ShareIcon />}>
            Share score
          </Button>
        )}
        <InstallAppButton label="Install for later" afterMilestone />
        {!failed && (
          <Button color="primary" onClick={onClose}>
            Review final grid
          </Button>
        )}
        <Button color="primary" onClick={onQuit}>
          Choose scenario
        </Button>
        <Button
          color="primary"
          variant="contained"
          onClick={() => props.onRetry(victory)}
        >
          Try again
        </Button>
      </DialogActions>
    </Dialog>
  );
}
