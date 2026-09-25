import * as React from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import {
  challengeShareContent,
  challengeComparison,
} from "../../helpers/Challenge";
import { logEvent } from "../../Globals";
import ShareIcon from "@mui/icons-material/Share";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import numbro from "numbro";
import { VictoryDebriefType, VictoryType } from "../../Types";
import { fetchGlobalRank } from "../../reducers/User";
import { canShare, shareText } from "../../helpers/Share";
import ConceptIcon from "./ConceptIcon";
import { formatMoneyConcise } from "../../helpers/Format";
import { formatLargeMass } from "../../helpers/Units";
import { useUnits } from "./UnitsContext";

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

function RunDebrief({
  debrief,
}: {
  debrief: VictoryDebriefType;
}): React.JSX.Element {
  const units = useUnits();
  const reliability = `${(debrief.reliability * 100).toFixed(
    debrief.reliability >= 0.999 ? 2 : 1,
  )}%`;
  const metrics = [
    { concept: "supply" as const, label: "served", value: reliability },
    {
      concept: "money" as const,
      label: "cash",
      value: formatMoneyConcise(debrief.finalCash),
    },
    {
      concept: "customers" as const,
      label: "customers",
      value: numbro(debrief.finalCustomers).format({ average: true }),
    },
    {
      concept: "danger" as const,
      label: "emissions",
      value: formatLargeMass(debrief.kgco2e, units),
    },
    ...(debrief.scenarioMetrics || []).map((metric) => ({
      concept: metric.concept,
      label: metric.label,
      value: metric.value,
    })),
  ];
  return (
    <section className="victoryDebrief" aria-label="Mission results">
      {metrics.map((metric) => (
        <div key={metric.label} className="victoryMetric">
          <ConceptIcon concept={metric.concept} fontSize="small" />
          <strong>{metric.value}</strong>
          <span>{metric.label}</span>
        </div>
      ))}
    </section>
  );
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
  const [preview, setPreview] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);
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
  const displayTitle = failed
    ? endTitle || (victory.outcome === "bankrupt" ? "Bankrupt!" : "Fired!")
    : !endTitle || /^mission complete!?$/i.test(endTitle.trim())
      ? "Mission complete"
      : endTitle;
  const breakdownSummary = Object.keys(breakdown)
    .map(
      (category) =>
        `${formatScore(breakdown[category])} ${SCORE_LABELS[category] || category}`,
    )
    .join(" · ");

  const shared = challengeShareContent(victory);
  const comparison = challengeComparison(victory);
  const onShare = () => {
    setSharing(true);
    logEvent("challenge_share_attempt", {
      scenarioId: victory.scenarioId,
      eligible: shared.challenge,
    });
    shareText(shared.content).then((method) => {
      setSharing(false);
      if (method === "cancelled") {
        return; // The player changed their mind, which is not a failure to report
      }
      if (method === "unavailable") {
        props.onShareFailed();
        return;
      }
      setPreview(false);
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
            borderTop: "6px solid",
            borderColor: failed ? "error.main" : "warning.main",
          },
        },
      }}
    >
      <DialogTitle id="victory-title" sx={{ pb: 1.5 }}>
        <Stack spacing={0.5} sx={{ alignItems: "center", textAlign: "center" }}>
          {failed ? (
            <ReportProblemOutlinedIcon
              color="error"
              sx={{ fontSize: 44 }}
              aria-hidden
            />
          ) : (
            <EmojiEventsIcon
              color="warning"
              sx={{ fontSize: 44 }}
              aria-hidden
            />
          )}
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
        <Typography
          className="victoryScore"
          variant="h4"
          component="p"
          aria-label={`Final score ${formatScore(victory.score)} points`}
        >
          <strong>{formatScore(victory.score)}</strong> points
        </Typography>
        <Typography
          className="victoryScoreBreakdown"
          variant="body2"
          color="textSecondary"
        >
          {breakdownSummary}
        </Typography>
        {comparison && (
          <Typography role="status" sx={{ mt: 2 }}>
            {comparison}{" "}
            <Typography component="span" variant="body2" color="textSecondary">
              Shared score · unverified.
            </Typography>
          </Typography>
        )}
        {victory.debrief && <RunDebrief debrief={victory.debrief} />}
        {ranked && loggedIn && (
          <Typography
            className="victoryStanding"
            variant="body2"
            color="textSecondary"
          >
            {isPersonalBest ? (
              <span>New personal best</span>
            ) : (
              <span>Personal best {formatScore(previousBest as number)}</span>
            )}
            {!rankFailed && rank !== undefined && (
              <span> · #{formatScore(rank)} globally</span>
            )}
          </Typography>
        )}
        {ranked && !loggedIn && (
          <Typography
            className="victoryStanding"
            variant="body2"
            color="textSecondary"
            component="div"
          >
            <Button color="primary" onClick={onLogin} size="small">
              Log in
            </Button>
            to join the leaderboard
          </Typography>
        )}
      </DialogContent>
      <DialogActions
        className="victoryDialogActions"
        disableSpacing
        sx={{ px: { xs: 2, sm: 3 }, pb: 2 }}
      >
        <div className="victoryUtilityActions">
          {canShare() && (
            <Button
              color="primary"
              startIcon={<ShareIcon />}
              onClick={() => setPreview(true)}
            >
              {shared.challenge ? "Challenge a friend" : "Share result"}
            </Button>
          )}
          {!failed && (
            <Button color="primary" onClick={onClose}>
              Review grid
            </Button>
          )}
        </div>
        <div className="victoryNextActions">
          <Button
            color="primary"
            variant={failed ? "text" : "outlined"}
            onClick={failed ? onQuit : () => props.onRetry(victory)}
          >
            {failed ? "New game" : "Replay"}
          </Button>
          <Button
            color="primary"
            variant="contained"
            onClick={failed ? () => props.onRetry(victory) : onQuit}
          >
            {failed ? "Try again" : "New game"}
          </Button>
        </div>
      </DialogActions>
      <Dialog
        open={preview}
        onClose={() => !sharing && setPreview(false)}
        aria-labelledby="challenge-preview-title"
        aria-describedby="challenge-preview-copy"
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle id="challenge-preview-title">
          {shared.challenge ? "Challenge a friend" : "Share result"}
        </DialogTitle>
        <DialogContent>
          <Typography id="challenge-preview-copy">
            {shared.content.text}
          </Typography>
          <Typography variant="body2" color="textSecondary" sx={{ mt: 2 }}>
            {shared.challenge
              ? "Your friend starts with the same conditions."
              : "Shares your result and mission without matching starting conditions."}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={sharing} onClick={() => setPreview(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            autoFocus
            disabled={sharing}
            onClick={onShare}
          >
            Share
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
