import { useMoney } from "../components/base/CurrencyContext";
import {
  Box,
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
import { formatPercent } from "../helpers/Format";
import { formatLargeMassValueConcise, largeMassUnit } from "../helpers/Units";
import FinishedObjective from "../components/base/FinishedObjective";
import { KeepModCopy } from "../components/views/CoopModPreview";
import { getScenario } from "../data/Scenarios";
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
  working = false,
  onWatch,
  onRestart,
  onReturnToLobby,
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
  /** The host is already restarting or returning everyone to the lobby. */
  working?: boolean;
  onWatch: () => void;
  /** The host plays the same game again with the same players. */
  onRestart: () => void;
  /** The host brings everyone back to the custom game setup to choose a new game. */
  onReturnToLobby: () => void;
  onLeave: () => void;
}) {
  const { currency, formatMoneyConcise } = useMoney();
  const results = useAppSelector(
    (state) => state.game.multiplayer?.results ?? [],
  );
  const scenario = useAppSelector((state) =>
    getScenario(state.game.scenarioId, state.game.customScenario),
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
        {results
          .filter((result) => result.objectiveResults?.length)
          .map((company) => (
            <Box
              component="section"
              aria-label={`${company.name} objective results`}
              key={company.id}
              sx={{ mt: 2, overflowWrap: "anywhere" }}
            >
              <Typography component="h3" variant="subtitle1">
                {company.name} · Objectives
              </Typography>
              {company.objectiveResults?.map((result) => (
                <FinishedObjective
                  key={result.id}
                  result={result}
                  calendar={scenario}
                  currency={currency}
                />
              ))}
            </Box>
          ))}
        {!host && scenario?.mod && (
          <Box sx={{ mt: 2 }}>
            <KeepModCopy scenario={scenario} />
          </Box>
        )}
        {complete && !host && (
          <Typography role="status" sx={{ mt: 2 }}>
            Waiting for {hostName} to choose the next game.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        {/* Beside the host's Return to lobby, "Leave lobby" would read as the same thing. */}
        <Button onClick={onLeave} disabled={working}>
          {!complete ? "Leave" : host ? "Main menu" : "Leave lobby"}
        </Button>
        {!complete && (
          <Button variant="contained" onClick={onWatch}>
            Keep watching
          </Button>
        )}
        {complete && host && (
          <>
            <Button onClick={onReturnToLobby} disabled={working}>
              Return to lobby
            </Button>
            <Button variant="contained" onClick={onRestart} disabled={working}>
              Restart
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
