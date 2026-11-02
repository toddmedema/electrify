import { Typography } from "@mui/material";
import { isLegacyCampaignScenario } from "../../data/LegacyCampaign";
import type { VictoryDebriefType } from "../../Types";

/** Goal thresholds share the campaign's original dollar basis; closing cash stays nominal. */
export default function CampaignGoalBasis({
  scenarioId,
  results,
}: {
  scenarioId: number;
  results?: VictoryDebriefType["objectiveResults"];
}): React.JSX.Element | null {
  if (
    !isLegacyCampaignScenario(scenarioId) ||
    !results?.some(
      (result) =>
        result.metric === "monthlyBilledRate" ||
        result.metric === "monthEndDebt",
    )
  )
    return null;
  return (
    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
      Rate and debt goals use 1882 dollars. Cash and outstanding loans show the
      closing year's amounts.
    </Typography>
  );
}
