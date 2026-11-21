import { Box, Typography } from "@mui/material";
import type { ObjectiveResult } from "../../data/ScenarioObjectives";
import type { ScenarioType } from "../../Types";
import type { CurrencyType } from "../../helpers/Currency";
import {
  finishedObjectiveStatusText,
  objectiveGoalText,
  objectiveHeadingText,
  objectiveObservedText,
  objectiveTargetText,
  objectiveWindowText,
} from "../../helpers/ObjectivePresentation";

export default function FinishedObjective({
  result,
  calendar,
  currency,
  leadMessage,
}: {
  result: ObjectiveResult;
  calendar?: Pick<
    ScenarioType,
    "startingYear" | "startingMonth" | "durationMonths"
  >;
  currency: CurrencyType;
  leadMessage?: string;
}) {
  const { objective } = result;
  const target = objectiveTargetText(objective, currency);
  const acquisition = objective.metric === "utilityOwnership";
  const heading = objectiveHeadingText(objective);
  const first =
    "fromMonth" in objective ? objective.fromMonth : objective.deadlineMonth;
  const last = first + result.requiredMonths - 1;
  const monthOffset = (calendar?.startingMonth ?? 1) - 1;
  const window = calendar
    ? objectiveWindowText(
        objective,
        calendar.startingYear,
        calendar.durationMonths,
        monthOffset,
      )
    : objective.checkpoint
      ? `Month ${("deadlineMonth" in objective ? objective.deadlineMonth : objective.throughMonth) + 1}`
      : first === last
        ? `Month ${first + 1}`
        : `Months ${first + 1}–${last + 1}`;
  const goal =
    target === heading
      ? acquisition
        ? `${window} deadline`
        : window
      : calendar
        ? objectiveGoalText(
            objective,
            calendar.startingYear,
            calendar.durationMonths,
            monthOffset,
            currency,
          )
        : objective.checkpoint
          ? `${target} by ${window}`
          : `${target} · ${window}`;
  const observed = objectiveObservedText(result, currency);
  const reason =
    result.reason && !leadMessage?.includes(result.reason)
      ? result.reason
      : undefined;
  return (
    <Box
      sx={{ mt: 1.5, overflowWrap: "anywhere" }}
      data-objective-status={result.status}
    >
      <Typography component="p" variant="body2" sx={{ fontWeight: 600 }}>
        {heading} · {result.required ? "Required" : "Optional"} ·{" "}
        {finishedObjectiveStatusText[result.status]}
      </Typography>
      <Typography component="p" variant="body2" color="text.secondary">
        {[acquisition ? observed : goal, acquisition ? goal : observed, reason]
          .filter(Boolean)
          .join(" · ")}
      </Typography>
    </Box>
  );
}
