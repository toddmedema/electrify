import * as React from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Skeleton,
  Typography,
} from "@mui/material";
import ShareIcon from "@mui/icons-material/Share";
import numbro from "numbro";
import { VictoryType } from "../../Types";
import { fetchGlobalRank } from "../../reducers/User";
import { buildShareText, canShare, shareText } from "../../helpers/Share";

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

export interface StateProps {
  victory: VictoryType | null;
  loggedIn: boolean;
}

export interface DispatchProps {
  onClose: () => void;
  onQuit: () => void;
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
  const isPersonalBest =
    previousBest === undefined || victory.score > previousBest;

  const onShare = () => {
    const text = buildShareText({
      score: victory.score,
      scenarioName: victory.scenarioName,
      difficulty: victory.difficulty,
    });
    shareText(text).then((method) => {
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
      onClose={onClose}
      aria-labelledby="victory-title"
    >
      <DialogTitle id="victory-title">
        {endTitle || `You've retired!`}
      </DialogTitle>
      <DialogContent>
        {endMessage && (
          <Typography variant="body1" gutterBottom>
            {endMessage}
          </Typography>
        )}
        <Typography variant="body1">
          Your final score is <strong>{formatScore(victory.score)}</strong>:
        </Typography>
        <div style={{ margin: "8px 0" }}>
          {Object.keys(breakdown).map((category: string) => (
            <div key={category}>
              {breakdown[category]} pts from{" "}
              {SCORE_LABELS[category] || category}
            </div>
          ))}
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
      <DialogActions>
        {canShare() && (
          <Button color="primary" onClick={onShare} startIcon={<ShareIcon />}>
            Share
          </Button>
        )}
        <Button color="primary" onClick={onClose}>
          Keep playing
        </Button>
        <Button color="primary" variant="contained" onClick={onQuit}>
          Return to scenarios
        </Button>
      </DialogActions>
    </Dialog>
  );
}
