import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { SavedRunResult } from "../../Types";
import { ResultScore, resultTitle, RunDebrief } from "./RunResult";
import { difficultyLabel } from "../../Constants";

/** A historical result never dispatches game actions or enriches leaderboard state. */
export default function SavedResultDialog(props: {
  result?: SavedRunResult;
  name?: string;
  onClose: () => void;
}): React.JSX.Element {
  const result = props.result;
  return (
    <Dialog
      open={!!result}
      onClose={props.onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="saved-result-title"
    >
      {result && (
        <>
          <DialogTitle id="saved-result-title">
            {resultTitle(result)}
          </DialogTitle>
          <DialogContent>
            <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
              {props.name}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {result.scenarioName} · {difficultyLabel(result.difficulty)}
            </Typography>
            {result.endMessage && <Typography>{result.endMessage}</Typography>}
            <ResultScore result={result} />
            {result.debrief && <RunDebrief debrief={result.debrief} />}
          </DialogContent>
          <DialogActions>
            <Button autoFocus variant="contained" onClick={props.onClose}>
              Close
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
