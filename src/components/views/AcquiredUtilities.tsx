import * as React from "react";
import { UTILITY_AREAS, UTILITY_TARGETS } from "../../data/UtilityExpansion";
import { getCostTableIndex } from "../../data/Economy";
import { getDateFromMinute } from "../../helpers/DateTime";
import { formatCount, formatMoneyConcise } from "../../helpers/Format";
import type { GameType } from "../../Types";
import { ChevronDownGlyph } from "../base/Glyphs";

/** Ownership is a record; operating plants and regional connections stay in the fleet. */
export default function AcquiredUtilities({
  game,
  summaryRef,
}: {
  game: GameType;
  summaryRef: React.RefObject<HTMLElement>;
}) {
  const expansion = game.utilityExpansion;
  if (!expansion?.acquisitions.length) return null;
  const costIndex = getCostTableIndex(game.date, game.startingYear, game.seed);
  return (
    <details className="acquiredUtilities">
      <summary ref={summaryRef}>
        {`Acquired utilities (${expansion.acquisitions.length})`}
        <ChevronDownGlyph className="rowChevron" aria-hidden />
      </summary>
      <ul aria-label="Acquired utilities">
        {expansion.acquisitions.map((receipt) => {
          const utility = UTILITY_AREAS[receipt.targetId];
          const target = UTILITY_TARGETS.find(
            (target) => target.id === receipt.targetId,
          )!;
          const line = game.transmission?.lines.find(
            (line) => line.corridorId === target.corridorId,
          );
          const acquired = getDateFromMinute(receipt.minute, game.startingYear);
          const acquisitionDebt = expansion.loans
            .filter((loan) => loan.targetId === receipt.targetId)
            .reduce((sum, loan) => sum + loan.loanAmountLeft, 0);
          return (
            <li key={receipt.targetId}>
              <h3 className="facilityDetailHeading">{utility.name}</h3>
              <p className="acquiredUtilityDate">
                Acquired {acquired.month} {acquired.year}
              </p>
              <dl className="facilityStats">
                <div className="facilityStat">
                  <dt>Customers transferred at acquisition</dt>
                  <dd className="facilityStatValue">
                    {formatCount(receipt.transferredCustomers)}
                  </dd>
                </div>
                <div className="facilityStat">
                  <dt>Connection upkeep</dt>
                  <dd className="facilityStatValue">
                    {formatMoneyConcise(
                      ((line?.annualOperatingCost ?? 0) * costIndex) / 12,
                    )}
                    /mo
                  </dd>
                </div>
                <div className="facilityStat">
                  <dt>Connection loan remaining</dt>
                  <dd className="facilityStatValue">
                    {formatMoneyConcise(line?.loanAmountLeft ?? 0)}
                  </dd>
                </div>
                <div className="facilityStat">
                  <dt>Acquisition debt remaining</dt>
                  <dd className="facilityStatValue">
                    {formatMoneyConcise(acquisitionDebt)}
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
