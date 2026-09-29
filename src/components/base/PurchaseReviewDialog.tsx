import * as React from "react";
import { Button } from "@mui/material";
import DecisionDialog from "./DecisionDialog";
import ConceptIcon from "./ConceptIcon";
import DecisionImpactPreview, {
  DecisionImpactFactType,
} from "./DecisionImpactPreview";
import { purchaseTerms } from "../../helpers/Financials";
import { formatMoneyConcise } from "../../helpers/Format";
import { LOAN_MONTHS } from "../../Constants";

/**
 * The one warning a purchase card shows when the loan's down payment is out of reach, or
 * undefined when it is affordable.
 */
export function financingShortfallText(
  cash: number,
  downpayment: number,
): string | undefined {
  return cash >= downpayment
    ? undefined
    : `Need ${formatMoneyConcise(downpayment)} down payment · you have ${formatMoneyConcise(cash)}`;
}

export interface PurchaseReviewDialogProps {
  open: boolean;
  /** "Build 500MW Coal?" */
  title: React.ReactNode;
  cash: number;
  buildCost: number;
  interestRate: number;
  /** An existing loan balance rolled into the new one, as an intertie upgrade does */
  refinancedBalance?: number;
  /** The loan's term; facilities pass facilityLoanMonths, interties keep the standard term */
  loanMonths?: number;
  /** Gating beyond affordability (replay, an invalid quote); affordability is checked here */
  cashDisabled?: boolean;
  loanDisabled?: boolean;
  /** Shown above the facts: a site note, build options, a mission deadline */
  preface?: React.ReactNode;
  /** Facts that lead the list, before the money */
  leadingFacts?: DecisionImpactFactType[];
  /** Facts appended after the money, upkeep and timing facts */
  extraFacts?: DecisionImpactFactType[];
  upkeepPerMonth: number;
  /** When set, upkeep reads as a change from this monthly figure */
  upkeepBeforePerMonth?: number;
  upkeepLabel?: string;
  upkeepDetail?: string;
  /** Omitted when the preface already says when it opens */
  onlineInMonths?: number;
  onlineInLabel?: string;
  titleId?: string;
  loanButtonId?: string;
  onClose: () => void;
  /** Called at most once per opening, however quickly the buttons are clicked */
  onPurchase: (financed: boolean) => void;
}

/**
 * The shared cash-or-loan review for every purchase: generators, storage, interties and intertie
 * upgrades. The terms come from the same helper the reducer books them with.
 */
export default function PurchaseReviewDialog(
  props: PurchaseReviewDialogProps,
): React.JSX.Element {
  const {
    open,
    cash,
    buildCost,
    interestRate,
    refinancedBalance = 0,
    loanMonths = LOAN_MONTHS,
    onClose,
    onPurchase,
  } = props;
  // A double-click dispatches two click events before the closing dialog has necessarily
  // unmounted. The ref closes that window synchronously, and reopening rearms it.
  const purchaseSubmitted = React.useRef(false);
  React.useEffect(() => {
    if (open) {
      purchaseSubmitted.current = false;
    }
  }, [open]);
  const loan = purchaseTerms(
    buildCost,
    true,
    interestRate,
    refinancedBalance,
    loanMonths,
  );
  const cashDisabled = !!props.cashDisabled || cash < buildCost;
  const loanDisabled = !!props.loanDisabled || cash < loan.downpayment;

  const submit = (financed: boolean, event: React.MouseEvent) => {
    event.stopPropagation();
    if (purchaseSubmitted.current) {
      return;
    }
    purchaseSubmitted.current = true;
    onPurchase(financed);
  };

  const facts: DecisionImpactFactType[] = [
    ...(props.leadingFacts ?? []),
    {
      concept: "money",
      label: "Cash purchase",
      value: `${formatMoneyConcise(cash)} → ${formatMoneyConcise(cash - buildCost)}`,
    },
    {
      concept: "finances",
      label: "Loan option",
      value: `${formatMoneyConcise(loan.downpayment)} now + ${formatMoneyConcise(loan.monthlyPayment)}/mo (${(interestRate * 100).toFixed(2)}% for ${loanMonths / 12} years)`,
      detail: `Payments start now.${
        refinancedBalance > 0
          ? ` Includes refinancing the existing ${formatMoneyConcise(refinancedBalance)} balance at this rate and term.`
          : ""
      }`,
    },
    {
      concept: "money",
      label: props.upkeepLabel ?? "Estimated upkeep",
      value:
        props.upkeepBeforePerMonth === undefined
          ? `${formatMoneyConcise(props.upkeepPerMonth)}/mo`
          : `${formatMoneyConcise(props.upkeepBeforePerMonth)} → ${formatMoneyConcise(props.upkeepPerMonth)}/mo`,
      detail: props.upkeepDetail,
    },
    ...(props.onlineInMonths === undefined
      ? []
      : [
          {
            concept: "time" as const,
            label: props.onlineInLabel ?? "Online in",
            value: `${props.onlineInMonths} months`,
          },
        ]),
    ...(props.extraFacts ?? []),
  ];

  return (
    <DecisionDialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      titleId={props.titleId}
      title={props.title}
      closable
      contentClassName="noPadding"
      actions={
        <>
          <Button
            color="primary"
            variant="contained"
            disabled={cashDisabled}
            onClick={(event) => submit(false, event)}
            startIcon={<ConceptIcon concept="money" fontSize="small" />}
          >
            Pay cash
          </Button>
          <Button
            id={props.loanButtonId}
            color="primary"
            variant="outlined"
            disabled={loanDisabled}
            onClick={(event) => submit(true, event)}
            startIcon={<ConceptIcon concept="finances" fontSize="small" />}
          >
            Take loan
          </Button>
        </>
      }
    >
      {props.preface}
      <DecisionImpactPreview facts={facts} />
    </DecisionDialog>
  );
}
