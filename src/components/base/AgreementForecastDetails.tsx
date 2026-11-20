import type { CurrencyType } from "../../helpers/Currency";
import { useMoney } from "./CurrencyContext";
import { Button, Typography } from "@mui/material";
import type { PowerAgreementAccount } from "../../Types";
import { agreementDate } from "../../helpers/PowerAgreements";
import { formatNumber, formatPercent } from "../../helpers/Format";
import type { useAgreementForecast } from "./useAgreementForecast";
import BuildDetails, { BuildDetailRow } from "./BuildDetails";

/** Keep both comparison rows in place as the selected terms change. */
export default function AgreementForecastDetails({
  forecast,
  horizon,
  currency,
}: {
  forecast: ReturnType<typeof useAgreementForecast>;
  horizon: string;
  currency?: CurrencyType;
}) {
  const { formatForecastMoney } = useMoney(currency);
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
        : "Compared with omitting this agreement";
  const { withAgreement, withoutAgreement } = forecast.result ?? {};
  const demandServed =
    withAgreement &&
    withoutAgreement &&
    withAgreement.demandMWh > 0 &&
    withoutAgreement.demandMWh > 0
      ? {
          without: formatPercent(
            withoutAgreement.servedMWh / withoutAgreement.demandMWh,
          ),
          with: formatPercent(
            withAgreement.servedMWh / withAgreement.demandMWh,
          ),
        }
      : undefined;
  return (
    <>
      <BuildDetailRow
        label="Forecasted cash impact"
        value={
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
        }
      />
      <BuildDetailRow
        label="Forecasted grid impact"
        value={
          demandServed ? (
            <span
              className="powerAgreementGridImpact"
              title="Demand served without → with agreement"
            >
              <span aria-hidden="true">
                {demandServed.without.slice(0, -1)} → {demandServed.with}
              </span>
              <span className="srOnly">
                Demand served: {demandServed.without} without agreement,{" "}
                {demandServed.with} with agreement
              </span>
            </span>
          ) : (
            <Typography component="span" variant="body2" color="textSecondary">
              —
            </Typography>
          )
        }
      />
    </>
  );
}

export function RecordedAgreementHistory({
  account,
  startMinute = 0,
  currency,
}: {
  account?: PowerAgreementAccount;
  startMinute?: number;
  currency?: CurrencyType;
}) {
  const { formatMoneyConcise } = useMoney(currency);
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
