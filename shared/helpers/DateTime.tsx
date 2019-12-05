import {DAYS_PER_MONTH, DAYS_PER_YEAR, MONTHS, STARTING_YEAR} from 'app/Constants';
import {MonthType} from 'app/Types';

// Based on SF/California for now, v2 take in / change by location
export function getSunrise(month: MonthType) {
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
export function getSunset(month: MonthType) {
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

// TODO if per issues, check how many times per tick this gets called, could make it a selector based on gameState currentMinute
export function getDateFromMinute(minute: number) {
  const dayOfGame = Math.floor(minute / 1440);
  const dayOfYear = dayOfGame % DAYS_PER_YEAR;
  // const dayOfSeason = dayOfYear % DAYS_PER_SEASON;
  const yearsEllapsed = Math.floor(dayOfGame / DAYS_PER_YEAR);
  const year = yearsEllapsed + STARTING_YEAR;
  const monthNumber = Math.floor(dayOfYear / DAYS_PER_MONTH);
  const month = MONTHS[monthNumber];
  const minuteOfYear = minute - (yearsEllapsed * DAYS_PER_YEAR) * 1440;
  const percentOfYear = minuteOfYear / (DAYS_PER_YEAR * 1440);

  return {
    percentOfYear,
    month,
    year,
  };
}
