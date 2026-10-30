/* Shared metric sentences for runtime, author tools and the offline editor schema. */
const OBJECTIVE_DEFINITIONS = {
  customerRetention:
    "Customers at the deadline divided by the run's recorded starting customers.",
  emissionsBudget:
    "Total electricity and construction emissions over the window, including imports and exports.",
  emissionsPerDeliveredMWh:
    "Total emissions, including imports, exports and construction, per delivered customer MWh over the window.",
  localFuelShare:
    "Selected fuels' delivered electricity divided by all local fuel-delivered electricity over the window; imports and storage discharge have no fuel provenance.",
  fuelRetirement:
    "Own no asset of the specified fuel, including paused and unfinished assets, at the deadline and every later month close.",
  monthlyBilledRate:
    "Billed customer revenue per delivered kWh each month, excluding grants and exports.",
  monthEndDebt: "Outstanding loan principal each month, excluding interest.",
  utilityOwnership:
    "Acquire at least one named utility by the deadline; a completed connection alone does not transfer ownership.",
  assetRetirement:
    "Retire the named original assets by the deadline; replacement equipment is not targeted.",
};

module.exports = { OBJECTIVE_DEFINITIONS };
