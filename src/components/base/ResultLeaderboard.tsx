import * as React from "react";
import { Box, Typography } from "@mui/material";
import {
  collection,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { DIFFICULTY_LABELS } from "../../Constants";
import { isDesktopApp } from "../../Desktop";
import { getDb } from "../../Globals";
import { DifficultyType, ScoreType } from "../../Types";
import { formatScore } from "../../helpers/Format";
import { SCORE_VERSION } from "../../helpers/Scoring";

type Standing = Pick<ScoreType, "uid" | "displayName" | "score"> & {
  rank?: number;
  current?: boolean;
};

/** Public standings enrich the result without delaying this run's score or actions. */
export default function ResultLeaderboard({
  scenarioId,
  difficulty,
  currentScore,
  uid,
  displayName,
}: {
  scenarioId: number;
  difficulty: DifficultyType;
  currentScore: number;
  uid?: string;
  displayName?: string;
}): React.JSX.Element {
  const titleId = React.useId();
  const [scores, setScores] = React.useState<Standing[]>();
  const [rank, setRank] = React.useState<number>();
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    setScores(undefined);
    setRank(undefined);
    setFailed(false);
    async function load() {
      const native = process.env.REACT_APP_DESKTOP === "true" && isDesktopApp();
      const filters = [
        where("scoreVersion", "==", SCORE_VERSION),
        where("outcome", "==", "completed"),
        where("scenarioId", "==", scenarioId),
        where("difficulty", "==", difficulty),
      ];
      // Independent requests: a failed board must not hide this run or its available rank.
      const standings = (async () => {
        let leaders: Standing[];
        if (native) {
          const { desktopScores } = await import("../../DesktopScores");
          leaders = await desktopScores(scenarioId, difficulty, "global");
        } else {
          const snapshot = await getDocs(
            query(
              collection(getDb(), "scores"),
              ...filters,
              orderBy("score", "desc"),
              limit(3),
            ),
          );
          leaders = snapshot.docs.map((doc) => doc.data() as ScoreType);
        }
        if (live)
          setScores(
            leaders.slice(0, 3).map((entry, index) => ({
              ...entry,
              rank: entry.rank ?? index + 1,
            })),
          );
      })();
      const placement = (async () => {
        let position: number;
        if (native) {
          const { desktopScoreRank } = await import("../../DesktopScores");
          position = await desktopScoreRank(
            scenarioId,
            difficulty,
            currentScore,
          );
        } else {
          const better = await getCountFromServer(
            query(
              collection(getDb(), "scores"),
              ...filters,
              where("score", ">", currentScore),
              orderBy("score", "desc"),
            ),
          );
          position = better.data().count + 1;
        }
        if (live) setRank(position);
      })();
      const results = await Promise.allSettled([standings, placement]);
      if (live && results.some((result) => result.status === "rejected"))
        setFailed(true);
    }
    void load();
    return () => {
      live = false;
    };
  }, [scenarioId, difficulty, currentScore]);

  const current: Standing = {
    uid: uid || "",
    displayName: displayName || "You",
    score: currentScore,
    rank,
    current: true,
  };
  const alreadyListed = (scores || []).some(
    (entry) => uid && entry.uid === uid && entry.score === currentScore,
  );
  const leaders = (scores || [])
    .filter(
      (entry) => !(uid && entry.uid === uid && entry.score === currentScore),
    )
    .map((entry) => ({
      ...entry,
      rank:
        !alreadyListed &&
        rank !== undefined &&
        entry.rank !== undefined &&
        entry.rank >= rank
          ? entry.rank + 1
          : entry.rank,
    }));
  let rows: Standing[];
  if (rank !== undefined && rank <= 3) {
    rows = [...leaders];
    rows.splice(rank - 1, 0, current);
    rows = rows.slice(0, 3);
  } else {
    rows = [...leaders, current];
  }

  return (
    <Box
      component="section"
      className="resultLeaderboard"
      aria-labelledby={titleId}
    >
      <Typography id={titleId} component="h2" variant="subtitle2">
        Leaderboard · {DIFFICULTY_LABELS[difficulty]}
      </Typography>
      <table aria-labelledby={titleId}>
        <tbody>
          {rows.map((entry, index) => (
            <tr
              key={index}
              className={entry.current ? "currentRun" : undefined}
              aria-current={entry.current ? "true" : undefined}
              aria-label={entry.current ? "This run" : undefined}
            >
              <td
                aria-label={
                  entry.rank === undefined
                    ? "Rank pending"
                    : `Rank ${entry.rank}`
                }
              >
                {entry.rank === undefined ? "—" : formatScore(entry.rank)}
              </td>
              <td>{entry.displayName || "Anonymous"}</td>
              <td aria-label={`Score ${formatScore(entry.score)}`}>
                {formatScore(entry.score)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(failed || scores === undefined) && (
        <Typography variant="body2" color="textSecondary" role="status">
          {failed ? "Leaderboard unavailable right now." : "Loading scores…"}
        </Typography>
      )}
    </Box>
  );
}
