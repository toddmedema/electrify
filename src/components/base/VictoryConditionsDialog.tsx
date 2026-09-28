import * as React from "react";
import { Button } from "@mui/material";
import {
  DifficultyType,
  MeaningfulDecisionType,
  ScenarioType,
} from "../../Types";
import DecisionDialog from "./DecisionDialog";
import VictoryConditions from "./VictoryConditions";

export interface VictoryConditionsDialogProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  scenario: ScenarioType;
  difficulty?: DifficultyType;
  meaningfulDecisions?: MeaningfulDecisionType[];
  meaningfulDecisionGateWaived?: boolean;
}

/** What a scenario counts as a win, shown before the player commits to it. */
export default function VictoryConditionsDialog({
  open,
  onClose,
  title,
  scenario,
  difficulty,
  meaningfulDecisions,
  meaningfulDecisionGateWaived,
}: VictoryConditionsDialogProps): React.JSX.Element {
  return (
    <DecisionDialog
      open={open}
      onClose={onClose}
      title={title}
      closable
      actions={
        <Button color="primary" variant="contained" onClick={onClose}>
          Close
        </Button>
      }
    >
      <VictoryConditions
        ownership={scenario.ownership}
        dollarsPerkWh={scenario.dollarsPerkWh}
        startingCustomers={scenario.startingCustomers}
        minimumCustomerRetention={scenario.minimumCustomerRetention}
        reliabilityObjective={scenario.reliabilityObjective}
        difficulty={difficulty}
        meaningfulDecisions={meaningfulDecisions}
        meaningfulDecisionGateWaived={meaningfulDecisionGateWaived}
      />
    </DecisionDialog>
  );
}
