import {DAYS_PER_MONTH, DAYS_PER_YEAR, MONTHS, STARTING_YEAR} from 'app/Constants';
import {DateType, MonthType} from 'app/Types';

export function formatMonthChartAxis(t: number, multiyear: boolean) {
  if (multiyear) {
    return (t % 12 + 1) + '/' + Math.floor(t / 12).toString().slice(-2);
  }
  return MONTHS[t % 12];
}

export function formatHour(date: DateType): string {
  const time = new Date(`${date.year}-${date.monthNumber}-1 ${Math.floor(date.minuteOfDay / 60)}:00`);
  return time.toLocaleString('en-US', { hour: 'numeric', hour12: true });
}

// Based on SF/California for now, v2 take in / change by location
function getSunrise(month: MonthType) {
  switch (month) {
    case 'Jan':
      return 445;
    case 'Feb':
      return 430;
    case 'Mar':
      return 415;
    case 'Apr':
      return 400;
    case 'May':
      return 385;
    case 'June':
      return 365;
    case 'July':
      return 352;
    case 'Aug':
      return 374;
    case 'Sept':
      return 396;
    case 'Oct':
      return 426;
    case 'Nov':
      return 434;
    case 'Dec':
    default:
      return 440;
  }
}

// Based on SF/California for now, v2 change by location
function getSunset(month: MonthType) {
  switch (month) {
    case 'Jan':
      return 1020;
    case 'Feb':
      return 1041;
    case 'Mar':
      return 1062;
    case 'Apr':
      return 1084;
    case 'May':
      return 1134;
    case 'June':
      return 1184;
    case 'July':
      return 1235;
    case 'Aug':
      return 1200;
    case 'Sept':
      return 1164;
    case 'Oct':
      return 1132;
    case 'Nov':
      return 1095;
    case 'Dec':
    default:
      return 1055;
  }
}

export function getDateFromMinute(minute: number): DateType {
  const minuteOfDay = minute % 1440;
  const dayOfGame = Math.floor(minute / 1440);
  const dayOfYear = dayOfGame % DAYS_PER_YEAR;
  // const dayOfSeason = dayOfYear % DAYS_PER_SEASON;
  const yearsEllapsed = Math.floor(dayOfGame / DAYS_PER_YEAR);
  const year = yearsEllapsed + STARTING_YEAR;
  const monthNumber = Math.floor(dayOfYear / DAYS_PER_MONTH);
  const month = MONTHS[monthNumber];
  const percentOfMonth = minuteOfDay / 1440;
  const minuteOfYear = minute - (yearsEllapsed * DAYS_PER_YEAR) * 1440;
  const percentOfYear = minuteOfYear / (DAYS_PER_YEAR * 1440);
  const hourOfFullYear = Math.floor(monthNumber * 30 * 24 + minuteOfDay / 60);

  return {
    minute,
    minuteOfDay,
    hourOfFullYear,
    percentOfMonth: percentOfMonth || 0.00001,
    percentOfYear: percentOfYear || 0.00001,
    month,
    monthNumber,
    year,
    sunrise: getSunrise(month),
    sunset: getSunset(month),
  };
}
