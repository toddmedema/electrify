import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useAppSelector } from "../Store";
import { formatMoneyConcise, formatPercent } from "../helpers/Format";
import { formatLargeMassValueConcise, largeMassUnit } from "../helpers/Units";
import type { CompanyOutcomeType } from "../Types";

const OUTCOME_LABELS: Record<CompanyOutcomeType["outcome"], string> = {
  bankrupt: "Bankrupt",
  fired: "Fired",
  completed: "Completed",
};

/**
 * A company's run has ended. A company that failed retires while the others play on; once every
 * company has finished, the whole lobby sees the result and the host can choose the next game.
 */
export default function CoopResult({
  ending,
  complete,
  host,
  hostName,
  selfId,
  onWatch,
  onBackToLobby,
  onLeave,
}: {
  /** This player's own ending, if their company's run has ended. */
  ending?: CompanyOutcomeType;
  /** Every company has finished. */
  complete: boolean;
  host: boolean;
  hostName: string;
  /** Marks this player's own company in the table. */
  selfId?: string;
  onWatch: () => void;
  onBackToLobby: () => void;
  onLeave: () => void;
}) {
  const results = useAppSelector(
    (state) => state.game.multiplayer?.results ?? [],
  );
  const units = useAppSelector((state) => state.settings.units);
  const title = complete
    ? "Match complete"
    : (ending?.title ?? "Your run has ended");
  const message =
    ending?.reason ??
    (ending?.outcome === "bankrupt"
      ? "Your company ran out of money."
      : ending?.outcome === "completed"
        ? "Your company finished the scenario."
        : undefined);
  return (
    <Dialog open fullWidth maxWidth="sm" aria-labelledby="coop-result-title">
      <DialogTitle id="coop-result-title">{title}</DialogTitle>
      <DialogContent>
        {message && <Typography sx={{ mb: 1 }}>{message}</Typography>}
        {!complete && (
          <Typography color="textSecondary" sx={{ mb: 2 }}>
            The other companies play on. Your grid stays as it ended, and your
            speed choice no longer holds anyone up.
          </Typography>
        )}
        {/* Narrow windows scroll the table rather than clipping its last columns. */}
        <div
          className="coopResultTable"
          tabIndex={0}
          role="region"
          aria-label="Company results"
        >
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Company</TableCell>
                <TableCell>Result</TableCell>
                <TableCell align="right">Served</TableCell>
                <TableCell align="right">Emissions</TableCell>
                <TableCell align="right">Cash</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {results.map((result) => (
                <TableRow key={result.id}>
                  <TableCell component="th" scope="row">
                    {result.name}
                    {result.id === selfId ? " (you)" : ""}
                  </TableCell>
                  <TableCell>
                    {result.outcome === "completed"
                      ? OUTCOME_LABELS.completed
                      : `${OUTCOME_LABELS[result.outcome]} in month ${result.month}`}
                  </TableCell>
                  <TableCell align="right">
                    {formatPercent(result.reliability, 1)}
                  </TableCell>
                  <TableCell align="right">
                    {formatLargeMassValueConcise(result.kgco2e, units)}{" "}
                    {largeMassUnit(units)}
                  </TableCell>
                  <TableCell align="right">
                    {formatMoneyConcise(result.cash)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {complete && !host && (
          <Typography role="status" sx={{ mt: 2 }}>
            Waiting for {hostName} to choose the next game.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        {/* Beside the host's Back to lobby, "Leave lobby" would read as the same thing. */}
        <Button onClick={onLeave}>
          {!complete ? "Leave" : host ? "Main menu" : "Leave lobby"}
        </Button>
        {!complete && (
          <Button variant="contained" onClick={onWatch}>
            Keep watching
          </Button>
        )}
        {complete && host && (
          <Button variant="contained" onClick={onBackToLobby}>
            Back to lobby
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
