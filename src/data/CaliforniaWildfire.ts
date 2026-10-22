/**
 * Historical anchors for the January 2025 LADWP fire response, at the mission's 1% scale.
 *
 * These are interrupted accounts, not measured MW. Between dated reports we interpolate linearly
 * at day precision. Only January 14–28 is estimated: earlier reports combine windstorm and fire
 * outages; later counts include destroyed premises whose continuing demand is unknown.
 *
 * January 14: 17,962 fire-related accounts (62 non-fire accounts excluded):
 * https://ladwpnews.com/8pm-update-january-14-2025-ladwp-windstorm-and-fire-response-continues/
 * January 20: approximately 9,500 in Pacific Palisades:
 * https://ladwpnews.com/january-20-2025-morning-update-ladwps-windstorm-and-wildfire-response/
 * January 21: approximately 8,500:
 * https://ladwpnews.com/january-21-2025-evening-update-ladwps-windstorm-and-wildfire-response/
 * January 28: approximately 8,410:
 * https://ladwpnews.com/remarks-by-ladwp-executives-about-wind-and-wildfire-response-january-2025-presented-at-board-of-water-and-power-commission-meeting-jan-28/
 */
export const CALIFORNIA_WILDFIRE_ISOLATED_ACCOUNTS = [
  { day: 14, accounts: 17_962 },
  { day: 20, accounts: 9_500 },
  { day: 21, accounts: 8_500 },
  { day: 28, accounts: 8_410 },
] as const;

export const CALIFORNIA_WILDFIRE_ACCOUNT_HOURS =
  CALIFORNIA_WILDFIRE_ISOLATED_ACCOUNTS.reduce((hours, current, index, all) => {
    if (index === 0) return hours;
    const previous = all[index - 1];
    return (
      hours +
      ((previous.accounts + current.accounts) / 2) *
        (current.day - previous.day) *
        24
    );
  }, 0);

// The scenario uses LADWP's rounded 1.6M-account baseline. Each isolated account is assumed to
// have average system load, solely to estimate service and billing. This is not measured outage
// energy or a claim that damaged buildings kept consuming power. The engine's real month is
// 365 days / 12 = 730 hours; its representative-day dispatch cannot reproduce outage chronology.
export const CALIFORNIA_WILDFIRE_SERVICE_INTERRUPTION_FRACTION =
  CALIFORNIA_WILDFIRE_ACCOUNT_HOURS / 1_600_000 / 730;

// LADWP's March 20 estimate includes windstorm, wildfire, rainstorm, response labor and repairs.
// Preserve that scope, use 2025 dollars, and scale its $78M once to this 1%-scale mission. Equal
// January–March installments are a billing convention, not an observed monthly spending curve.
// https://cityclerk.lacity.org/onlinedocs/2025/25-0006-S23_rpt_dwp_3-20-25.pdf
export const CALIFORNIA_WILDFIRE_REPAIR_COST_YEAR = 2025;
export const CALIFORNIA_WILDFIRE_REPAIR_COST = 780_000;
export const CALIFORNIA_WILDFIRE_REPAIR_COST_PER_MONTH =
  CALIFORNIA_WILDFIRE_REPAIR_COST / 3;

// One reserved mobile diesel is an explicit critical-load allocation. PG&E's July 20–21, 2024
// report Table 14 lists 0.2MW units with a 24h estimated runtime at 75% load. Count initial fuel
// once; do not assume refueling or reconnect customers through an isolated utility feeder.
// https://www.pge.com/assets/pge/docs/outages-and-safety/outage-preparedness-and-support/7-20-2024-psps-post-event-report-08-02-2024.pdf
export const CALIFORNIA_WILDFIRE_BACKUP_POWER_W = 150_000;
export const CALIFORNIA_WILDFIRE_BACKUP_HOURS = 24;
export const CALIFORNIA_WILDFIRE_BACKUP_WH =
  CALIFORNIA_WILDFIRE_BACKUP_POWER_W * CALIFORNIA_WILDFIRE_BACKUP_HOURS;

// Representative equipment, not identification of PG&E's actual unit: Cummins' October 2024
// C200D2RE brochure reports 8.9 US gal/h at 135 kW and 10.3 at 180 kW. Interpolate at 150 kW.
// EPA's January 2025 Table 1 gives No. 2 distillate 10.21 kg CO2, 0.41 g CH4, and 0.08 g N2O
// per US gallon; its AR5 100-year GWPs are 28 and 265. Combustion only, without upstream or
// manufacturing emissions, auxiliary transport, or diesel exhaust fluid.
// https://mart.cummins.com/imagelibrary/data/assetfiles/0057134.pdf
// https://www.epa.gov/system/files/documents/2025-01/ghg-emission-factors-hub-2025.pdf
const BACKUP_DIESEL_GAL_PER_HOUR =
  8.9 +
  ((10.3 - 8.9) * (CALIFORNIA_WILDFIRE_BACKUP_POWER_W / 1000 - 135)) /
    (180 - 135);
export const CALIFORNIA_WILDFIRE_BACKUP_KGCO2E_PER_MWH =
  ((10.21 + (0.41 / 1000) * 28 + (0.08 / 1000) * 265) *
    BACKUP_DIESEL_GAL_PER_HOUR) /
  (CALIFORNIA_WILDFIRE_BACKUP_POWER_W / 1e6);

// Transferred readiness/logistics allowance, not a LADWP generator quotation or a measured
// causal benefit: see src/testing/SCENARIO_CHOICE_RESEARCH.md for the ~$191k SCE account proxy.
export const CALIFORNIA_WILDFIRE_READINESS_COST = 200_000;
