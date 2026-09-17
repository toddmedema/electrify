import { Box, Typography } from "@mui/material";
import { GameType } from "../../Types";
import { summarizeTimeline } from "../../helpers/DateTime";
import { compareEconomicFutures } from "../../helpers/EconomicFutures";
import { formatMoneyConcise } from "../../helpers/Format";

export default function EconomicFutureComparison({ game }: { game: GameType }) {
  const rows = compareEconomicFutures({
    annualFuelExpense:
      summarizeTimeline(game.timeline, game.startingYear).expensesFuel * 12,
    date: game.date,
    seed: game.seed,
  });
  return (
    <Box component="details" sx={{ mx: 2, my: 1 }}>
      <Box component="summary" sx={{ cursor: "pointer", minHeight: 44, py: 1 }}>
        Compare possible costs in five years
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Assumes today's fuel use continues.
      </Typography>
      {rows.map((row) => (
        <Box
          key={row.id}
          sx={{ py: 1, borderBottom: 1, borderColor: "divider" }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {row.label}
          </Typography>
          <Typography variant="body2">
            Fuel: {formatMoneyConcise(row.annualFuelExpense)}/year with{" "}
            {(row.annualFuelGrowth * 100).toFixed(0)}% annual price growth
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Prime borrowing rate: {(row.primeRate * 100).toFixed(1)}% ·
            Inflation: {(row.inflationRate * 100).toFixed(1)}%
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
