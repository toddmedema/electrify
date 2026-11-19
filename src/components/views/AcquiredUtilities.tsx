import { useMoney } from "../base/CurrencyContext";
import * as React from "react";
import { UTILITY_TARGETS } from "../../data/UtilityExpansion";
import { municipalUtility } from "../../data/MunicipalUtilities";
import { utilityAcquisitions } from "../../helpers/Expansion";
import { legacyTerritoryConnections } from "../../helpers/Territories";
import { getDateFromMinute } from "../../helpers/DateTime";
import { formatCount } from "../../helpers/Format";
import { getTotalDebt } from "../../helpers/Financials";
import type { GameType } from "../../Types";
import { ChevronDownGlyph } from "../base/Glyphs";

/** Ownership is a record; operating plants and dated obligations join the company pool. */
export default function AcquiredUtilities({
  game,
  summaryRef,
  acquisitions = utilityAcquisitions(game),
}: {
  game: GameType;
  summaryRef: React.RefObject<HTMLElement>;
  acquisitions?: ReturnType<typeof utilityAcquisitions>;
}) {
  const { formatMoneyConcise } = useMoney();
  const expansion = game.utilityExpansion;
  if (!acquisitions.length) return null;
  return (
    <details className="acquiredUtilities">
      <summary ref={summaryRef}>
        {`Acquired utilities (${acquisitions.length})`}
        <ChevronDownGlyph className="rowChevron" aria-hidden />
      </summary>
      <ul aria-label="Acquired utilities">
        {acquisitions.map((receipt) => {
          const target = UTILITY_TARGETS.find(
            (target) => target.id === receipt.targetId,
          );
          const name = target?.name ?? municipalUtility(receipt.targetId)?.name;
          const line = [
            ...(game.transmission?.lines ?? []),
            ...legacyTerritoryConnections(game),
          ].find((line) => line.corridorId === target?.corridorId);
          const acquired = getDateFromMinute(receipt.minute, game.startingYear);
          const outstandingLoans = [
            ...(line ? [line] : []),
            ...(expansion?.loans ?? []).filter(
              (loan) => loan.targetId === receipt.targetId,
            ),
          ].filter((loan) => loan.loanAmountLeft > 0);
          const monthlyDebtPayment = outstandingLoans.reduce(
            (sum, loan) => sum + loan.loanMonthlyPayment,
            0,
          );
          return (
            <li key={receipt.targetId}>
              <h3 className="facilityDetailHeading">{name}</h3>
              <p className="acquiredUtilityDate">
                Acquired {acquired.month} {acquired.year}
              </p>
              <dl className="facilityStats">
                <div className="facilityStat">
                  <dt>Customers acquired</dt>
                  <dd className="facilityStatValue">
                    {formatCount(receipt.transferredCustomers)}
                  </dd>
                </div>
                <div className="facilityStat">
                  <dt>Debt payment</dt>
                  <dd className="facilityStatValue">
                    {formatMoneyConcise(monthlyDebtPayment)}/mo
                  </dd>
                </div>
                <div className="facilityStat">
                  <dt>Debt remaining</dt>
                  <dd className="facilityStatValue">
                    {formatMoneyConcise(getTotalDebt(outstandingLoans))}
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
