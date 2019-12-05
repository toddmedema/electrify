import {DAYS_PER_SEASON, DAYS_PER_YEAR, SEASONS, STARTING_YEAR} from 'app/Constants';
import {SeasonType} from 'app/Types';

// Based on SF/California for now, v2 take in / change by location
export function getSunrise(season: SeasonType) {
  switch (season) {
    case 'Spring':
      return 400;
    case 'Summer':
      return 352;
    case 'Fall':
      return 426;
    case 'Winter': // jan 1
    default:
      return 445;
  }
}

// Based on SF/California for now, v2 change by location
export function getSunset(season: SeasonType) {
  switch (season) {
    case 'Spring':
      return 1084;
    case 'Summer':
      return 1235;
    case 'Fall':
      return 1132;
    case 'Winter': // jan 1
    default:
      return 1020;
  }
}

// TODO if per issues, check how many times per tick this gets called, could make it a selector based on gameState currentMinute
export function getDateFromMinute(minute: number) {
  const dayOfGame = Math.floor(minute / 1440);
  const dayOfYear = dayOfGame % DAYS_PER_YEAR;
  // const dayOfSeason = dayOfYear % DAYS_PER_SEASON;
  const yearsEllapsed = Math.floor(dayOfGame / DAYS_PER_YEAR);
  const year = yearsEllapsed + STARTING_YEAR;
  const seasonNumber = Math.floor(dayOfYear / DAYS_PER_SEASON);
  const season = SEASONS[seasonNumber];
  const minuteOfSeason = minute - (yearsEllapsed * DAYS_PER_YEAR + seasonNumber * DAYS_PER_SEASON) * 1440;
  const percentOfSeason = minuteOfSeason / (DAYS_PER_SEASON * 1440);

  return {
    percentOfSeason,
    season,
    year,
  };
}
