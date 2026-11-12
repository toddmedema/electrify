import * as React from "react";
import { Box, Button, Typography } from "@mui/material";
import type { GameType, TransmissionLineOperatingType } from "../../Types";
import {
  agreementDate,
  agreementYearMinute,
  connectionAgreements,
  inheritedUtilityForCorridor,
  POWER_AGREEMENT_BLOCKS,
  powerAgreementQuote,
} from "../../helpers/PowerAgreements";
import { formatMoneyConcise, formatWatts } from "../../helpers/Format";
import { useAppDispatch } from "../../Store";
import {
  acceptPowerAgreement,
  closePolicyDecision,
  openPolicyDecision,
  snackbarOpen,
} from "../../reducers/GameActions";
import DecisionDialog from "./DecisionDialog";
import BuildDetails, { BuildDetailRow } from "./BuildDetails";

export function agreementSummary(game: GameType, corridorId: string) {
  const utility = inheritedUtilityForCorridor(corridorId);
  if (!utility) return undefined;
  const coverage = connectionAgreements(game, utility).reduce(
    (sum, source) => sum + (source.active ? source.nominalW : 0),
    0,
  );
  const replacement = POWER_AGREEMENT_BLOCKS.some(
    (block) =>
      block.utilityId === utility && powerAgreementQuote(game, block.id),
  );
  return `${formatWatts(coverage)} under agreement${replacement ? " · Replacement available" : ""}`;
}
export default function PowerAgreements({
  game,
  line,
}: {
  game: GameType;
  line: TransmissionLineOperatingType;
}) {
  const dispatch = useAppDispatch();
  const [review, setReview] =
    React.useState<ReturnType<typeof powerAgreementQuote>>();
  const restore = React.useRef<HTMLElement | null>(null);
  const utility = inheritedUtilityForCorridor(line.corridorId);
  const token = `power-agreement:${line.id}`;
  React.useEffect(() => {
    if (!review) return;
    dispatch(openPolicyDecision(token));
    return () => {
      dispatch(closePolicyDecision(token));
    };
  }, [dispatch, token, review]);
  if (!utility) return null;
  const sources = connectionAgreements(game, utility);
  const close = () => setReview(undefined);
  return (
    <Box
      component="section"
      aria-label="Power purchase agreements"
      className="powerAgreements"
    >
      <Typography component="h3" variant="subtitle2">
        Power purchase agreements
      </Typography>
      {sources.map((source) => {
        const expired = game.date.minute >= source.endMinute;
        // A block's next cycle belongs beneath its latest agreement, never duplicated beneath
        // the original inherited reduction after that replacement was accepted.
        const block = POWER_AGREEMENT_BLOCKS.find((entry) =>
          source.inherited
            ? entry.id === source.id
            : source.id.startsWith(`${entry.id}:`),
        );
        const latest =
          block &&
          sources.filter((other) => other.id.startsWith(`${block.id}:`)).at(-1);
        const hasLater = !!latest && latest.id !== source.id;
        const quote =
          block && !hasLater ? powerAgreementQuote(game, block.id) : undefined;
        return (
          <Box key={source.id} className="powerAgreement">
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {source.name} ·{" "}
              {expired
                ? `Expired ${agreementDate(source.endMinute)}`
                : source.inherited
                  ? "Inherited"
                  : source.startMinute > game.date.minute
                    ? `Scheduled · starts ${agreementDate(source.startMinute)}`
                    : "Active"}
            </Typography>
            {!expired && (
              <>
                <Typography variant="body2">
                  {formatWatts(source.nominalW)} covered ·{" "}
                  {formatMoneyConcise(source.priceToday)}/MWh, follows inflation
                </Typography>
                <Typography
                  variant="caption"
                  color="textSecondary"
                  component="p"
                  sx={{ my: 0.5 }}
                >
                  Up to {formatWatts(source.nominalW * source.deliverability)}{" "}
                  deliverable
                </Typography>
                <Typography variant="body2">
                  {source.inherited
                    ? `Through ${agreementDate(source.endMinute, true)}`
                    : `${agreementDate(source.startMinute)}–${agreementDate(source.endMinute, true)}`}
                </Typography>
                {source.reductionYear !== undefined &&
                  game.date.minute <
                    agreementYearMinute(source.reductionYear) &&
                  (source.reducedNominalW ?? 0) > 0 && (
                    <Typography variant="body2" color="warning.main">
                      {formatWatts(source.nominalW)} →{" "}
                      {formatWatts(source.reducedNominalW!)} on 1 Jan{" "}
                      {source.reductionYear}
                    </Typography>
                  )}
              </>
            )}
            {quote && (
              <Button
                variant="outlined"
                size="small"
                aria-label={`Review ${quote.name} replacement`}
                onClick={(event) => {
                  restore.current = event.currentTarget;
                  setReview(quote);
                }}
              >
                Review replacement
              </Button>
            )}
          </Box>
        );
      })}
      <Typography variant="body2" color="textSecondary">
        Agreements and market purchases share this connection. Uncovered
        purchases use regional market prices and availability.
      </Typography>
      <DecisionDialog
        open={!!review}
        fullWidth
        maxWidth="sm"
        closable
        title={`Review ${review?.name ?? "power"} replacement`}
        onClose={close}
        disableRestoreFocus
        onExited={() => restore.current?.focus()}
        actions={
          <>
            <Button onClick={close}>Back</Button>
            <Button
              variant="contained"
              onClick={() => {
                if (!review) return;
                const fresh = powerAgreementQuote(game, review.id);
                if (fresh?.quoteKey !== review.quoteKey) {
                  close();
                  dispatch(
                    snackbarOpen(
                      "Agreement terms changed; review the replacement again.",
                    ),
                  );
                  return;
                }
                dispatch(
                  acceptPowerAgreement({
                    blockId: review.id,
                    quoteKey: review.quoteKey,
                  }),
                );
                restore.current = document.getElementById(
                  `intertie-disclosure-${line.id}`,
                );
                close();
                dispatch(
                  snackbarOpen(
                    `Agreement accepted; delivery starts ${agreementDate(review.receipt.startMinute)}`,
                  ),
                );
              }}
            >
              Accept agreement
            </Button>
          </>
        }
      >
        {review && (
          <>
            <BuildDetails label="Replacement agreement terms">
              <BuildDetailRow
                label="Coverage"
                value={`${formatWatts(review.nominalW)} · up to ${formatWatts(review.deliverableW)} deliverable`}
              />
              <BuildDetailRow
                label="Delivery"
                value={`${agreementDate(review.receipt.startMinute)}–${agreementDate(review.receipt.endMinute, true)}`}
              />
              <BuildDetailRow
                label="Price today"
                value={
                  <>
                    {formatMoneyConcise(review.priceToday)}/MWh
                    <Typography
                      component="div"
                      variant="caption"
                      color="textSecondary"
                    >
                      Follows inflation · ${review.pricePerMWh}/MWh in 2005
                      dollars
                    </Typography>
                  </>
                }
              />
              <BuildDetailRow
                label="Payment"
                value="$0 upfront · pay for delivered energy"
              />
            </BuildDetails>
            <Typography variant="body2" sx={{ mt: 2 }}>
              Covered imports use this agreed rate before market pricing. Local
              generation can reduce purchases.
            </Typography>
          </>
        )}
      </DecisionDialog>
    </Box>
  );
}
