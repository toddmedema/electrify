import type { DateType } from "../../Types";
import { formatHour } from "../../helpers/DateTime";
import "./GameCalendar.scss";

/** Shared calendar markup keeps solo and the couch shell on the same presentation. */
export function GameDate({
  date,
  showTime,
}: {
  date: DateType;
  showTime: boolean;
}) {
  return (
    <span className="weak gameStatusValue">
      <span>
        {date.month} {date.year}
        {showTime && (
          <span className="gameStatusHour">, {formatHour(date)}</span>
        )}
      </span>
    </span>
  );
}

export function YearProgressBar({ date }: { date: DateType }) {
  return (
    <div
      id="yearProgressBar"
      className="gameYearProgressBar"
      role="progressbar"
      aria-label={`Year ${date.year}: ${Math.round(date.percentOfYear * 100)}% elapsed`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(date.percentOfYear * 100)}
    >
      <div
        className="yearProgressFill"
        style={{ width: `${date.percentOfYear * 100}%` }}
      />
    </div>
  );
}
