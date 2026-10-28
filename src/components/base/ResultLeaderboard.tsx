import * as React from "react";
import { Box, Typography } from "@mui/material";
import {
  collection,
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

/** Public standings enrich the result without delaying its score or actions. */
export default function ResultLeaderboard({
  scenarioId,
  difficulty,
}: {
  scenarioId: number;
  difficulty: DifficultyType;
}): React.JSX.Element {
  const titleId = React.useId();
  const [scores, setScores] = React.useState<ScoreType[]>();
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    async function load() {
      try {
        let leaders: ScoreType[];
        if (process.env.REACT_APP_DESKTOP === "true" && isDesktopApp()) {
          const { desktopScores } = await import("../../DesktopScores");
          leaders = await desktopScores(scenarioId, difficulty, "global");
        } else {
          const snapshot = await getDocs(
            query(
              collection(getDb(), "scores"),
              where("scoreVersion", "==", SCORE_VERSION),
              where("outcome", "==", "completed"),
              where("scenarioId", "==", scenarioId),
              where("difficulty", "==", difficulty),
              orderBy("score", "desc"),
              limit(3),
            ),
          );
          leaders = snapshot.docs.map((doc) => doc.data() as ScoreType);
        }
        if (live) setScores(leaders.slice(0, 3));
      } catch {
        if (live) setFailed(true);
      }
    }
    void load();
    return () => {
      live = false;
    };
  }, [scenarioId, difficulty]);

  return (
    <Box
      component="section"
      className="resultLeaderboard"
      aria-labelledby={titleId}
    >
      <Typography id={titleId} component="h2" variant="subtitle2">
        Leaderboard · {DIFFICULTY_LABELS[difficulty]}
      </Typography>
      {scores && scores.length > 0 ? (
        <table aria-labelledby={titleId}>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Player</th>
              <th scope="col">Score</th>
            </tr>
          </thead>
          <tbody>
            {scores.map((score, index) => (
              <tr key={index}>
                <td>{index + 1}</td>
                <td>{score.displayName || "Anonymous"}</td>
                <td>{formatScore(score.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Typography variant="body2" color="textSecondary" role="status">
          {failed
            ? "Leaderboard unavailable right now."
            : scores
              ? "No scores yet for this difficulty."
              : "Loading scores…"}
        </Typography>
      )}
    </Box>
  );
}
