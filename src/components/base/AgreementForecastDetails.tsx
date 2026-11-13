import { Button, Typography } from "@mui/material";
import type { PowerAgreementAccount } from "../../Types";
import { agreementDate } from "../../helpers/PowerAgreements";
import {
  formatMoneyConcise,
  formatForecastMoney,
  formatNumber,
} from "../../helpers/Format";
import type { useAgreementForecast } from "./useAgreementForecast";
import BuildDetails, { BuildDetailRow } from "./BuildDetails";

/** The comparison occupies one value cell; quoted terms stay available in every state. */
export default function AgreementForecastDetails({
  forecast,
  horizon,
}: {
  forecast: ReturnType<typeof useAgreementForecast>;
  horizon: string;
}) {
  const unavailable =
    forecast.blocked === "coop"
      ? "Unavailable in co-op"
      : forecast.blocked === "buying"
        ? "Comparison unavailable"
        : undefined;
  const caption =
    forecast.blocked === "coop"
      ? "Shared supply depends on other companies"
      : forecast.blocked === "buying"
        ? "Turn on market buying to compare"
        : "Based on current supply and demand";
  return (
    <>
      <span role="status" aria-live="polite">
        {unavailable ??
          (forecast.result
            ? `${formatForecastMoney(forecast.result.cashDifference)} ${horizon}`
            : forecast.error
              ? "Forecast unavailable"
              : forecast.updating
                ? "Updating…"
                : "Calculating…")}
      </span>
      {forecast.error && !unavailable && (
        <Button size="small" onClick={forecast.retry}>
          Retry
        </Button>
      )}
      <Typography component="div" variant="caption" color="textSecondary">
        {caption}
      </Typography>
    </>
  );
}

export function RecordedAgreementHistory({
  account,
  startMinute = 0,
}: {
  account?: PowerAgreementAccount;
  startMinute?: number;
}) {
  if (!account)
    return (
      <Typography color="textSecondary">Earlier history unavailable</Typography>
    );
  const totals = account.months.reduce(
    (sum, row) => ({
      usefulMWh: sum.usefulMWh + row.usefulMWh,
      payment: sum.payment + row.payment,
    }),
    { usefulMWh: 0, payment: 0 },
  );
  return (
    <>
      <BuildDetails label="Recorded agreement history">
        <BuildDetailRow
          label={`Recorded since ${agreementDate(account.accountingStartMinute)}`}
          value={`${formatNumber(totals.usefulMWh, { maximumFractionDigits: 0 })} MWh used · ${formatMoneyConcise(totals.payment)} paid`}
        />
      </BuildDetails>
      {account.accountingStartMinute > startMinute && (
        <Typography variant="body2" color="textSecondary">
          Earlier history unavailable
        </Typography>
      )}
    </>
  );
}
