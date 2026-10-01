import * as React from "react";
import {
  Alert,
  Button,
  CircularProgress,
  Slider,
  TextField,
  Typography,
} from "@mui/material";
import { sliderTickToW, wToSliderTick } from "../../helpers/BuildSizing";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import { CityType, getCities, initCities } from "../../data/Cities";
import { getDataCenterCustomerProfile } from "../../data/DataCenterCustomers";
import { getDataCenterPowerMix } from "../../data/DataCenterPowerMix";
import {
  configureDataCenterGrowth,
  MIN_DATA_CENTER_YEAR as MIN_YEAR,
  MAX_DATA_CENTER_YEAR as MAX_YEAR,
} from "../../helpers/DataCenterScenario";
import {
  DataCenterSetupRequest,
  DataCenterSetupResponse,
} from "../../helpers/DataCenterSetup";
import { createDataCenterSetupWorker } from "../../helpers/DataCenterSetupClient";
import { formatCount, formatWatts } from "../../helpers/Format";
import { prefetchScenarioData } from "../../helpers/OfflineData";
import { ScenarioType } from "../../Types";
import ScreenHeader from "../base/ScreenHeader";
import LocationPicker from "../base/LocationPicker";
import {
  useWorkerRequest,
  WorkerRequestOptions,
} from "../base/useWorkerRequest";

const SETUP_WORKER: WorkerRequestOptions<
  DataCenterSetupResponse,
  ScenarioType
> = {
  createWorker: () => createDataCenterSetupWorker(),
  debounceMs: 150,
  reuseWorker: true,
  read: (reply) =>
    "scenario" in reply ? { result: reply.scenario } : undefined,
};

export interface Props {
  onBack: () => void;
  onStart: (scenario: ScenarioType) => void;
}

const ZERO_DEMAND_TICK = wToSliderTick(10e6) - 1;
const MAX_DEMAND_TICK = wToSliderTick(10e9);
const demandAtTick = (tick: number) =>
  tick === ZERO_DEMAND_TICK ? 0 : sliderTickToW(tick);
const formatDemandPower = (watts: number) =>
  watts === 0 ? "0MW" : formatWatts(watts);
const validYear = (year: number) =>
  Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR;
const validStartingYear = (year: number) => validYear(year) && year < MAX_YEAR;
const YEARS = Array.from(
  { length: MAX_YEAR - MIN_YEAR + 1 },
  (_, index) => MIN_YEAR + index,
);

export default function DataCenterSetup({ onBack, onStart }: Props) {
  const [startingYearInput, setStartingYearInput] = React.useState(() =>
    String(
      Math.max(MIN_YEAR, Math.min(MAX_YEAR - 1, new Date().getFullYear())),
    ),
  );
  const startingYear = Number(startingYearInput);
  const [arrivalInput, setArrivalInput] = React.useState<string>();
  const arrivalYear =
    arrivalInput === undefined
      ? Math.min(MAX_YEAR, startingYear + 6)
      : Number(arrivalInput);
  const [cities, setCities] = React.useState(getCities);
  const [loading, setLoading] = React.useState(true);
  const [cityError, setCityError] = React.useState(false);
  const [location, setLocation] = React.useState<CityType | null>(null);
  const [demandTick, setDemandTick] = React.useState(wToSliderTick(100e6));
  const [accountsInput, setAccountsInput] = React.useState<string>();
  const [attempt, setAttempt] = React.useState(0);
  const customerProfile = location
    ? getDataCenterCustomerProfile(location)
    : undefined;
  const powerMix =
    location && validStartingYear(startingYear)
      ? getDataCenterPowerMix(location, startingYear)
      : undefined;
  const startingCustomers =
    accountsInput === undefined
      ? customerProfile?.customers
      : Number(accountsInput);
  const validAccounts =
    startingCustomers !== undefined &&
    Number.isInteger(startingCustomers) &&
    startingCustomers >= 1 &&
    startingCustomers <= 100000000;

  React.useEffect(() => {
    let active = true;
    initCities()
      .then((loaded) => {
        if (active) setCities(loaded);
      })
      .catch(() => {
        if (active) setCityError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    if (location) void prefetchScenarioData(location);
  }, [location]);

  const preparation = useWorkerRequest(
    location && validStartingYear(startingYear) && validAccounts
      ? {
          key: `${location.id}:${startingYear}:${startingCustomers}:${attempt}`,
          scope: location,
          message: (requestId: number): DataCenterSetupRequest => ({
            requestId,
            location,
            startingYear,
            startingCustomers,
          }),
        }
      : undefined,
    SETUP_WORKER,
  );
  const growthScenario =
    preparation.status === "ready" ? preparation.result : undefined;
  const demandW = demandAtTick(demandTick);
  const validArrival = validYear(arrivalYear) && arrivalYear > startingYear;
  const scenario = React.useMemo(
    () =>
      growthScenario && validArrival
        ? configureDataCenterGrowth(growthScenario, demandW, arrivalYear)
        : undefined,
    [growthScenario, validArrival, demandW, arrivalYear],
  );

  return (
    <div id="listCard" className="flexContainer screenDataCenterSetup">
      <ScreenHeader title="Explore data center growth" onBack={onBack} />
      <div className="scrollable">
        <div className="dataCenterSetupContent">
          <Typography>
            Explore what new data centers could mean for your local grid.
          </Typography>
          <LocationPicker
            showHeading={false}
            allowNearest
            searchLabel="Select a city"
            locations={cities}
            value={location || undefined}
            loading={loading}
            onChange={(selected) => {
              setLocation(selected);
              setDemandTick(wToSliderTick(100e6));
              setAccountsInput(undefined);
            }}
          />
          {location && (
            <div className="dataCenterSetupYears">
              <TextField
                select
                label="Start year"
                value={startingYearInput}
                slotProps={{ select: { native: true } }}
                onChange={(event) => {
                  const year = Number(event.target.value);
                  if (!validStartingYear(year)) return;
                  setStartingYearInput(String(year));
                  if (
                    arrivalInput !== undefined &&
                    Number(arrivalInput) <= year
                  ) {
                    setArrivalInput(String(year + 1));
                  }
                }}
              >
                {YEARS.slice(0, -1).map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </TextField>
              <span aria-hidden="true">-</span>
              <TextField
                select
                label="Data centers open"
                value={arrivalYear}
                slotProps={{ select: { native: true } }}
                onChange={(event) => {
                  const year = Number(event.target.value);
                  if (validYear(year) && year > startingYear)
                    setArrivalInput(String(year));
                }}
              >
                {YEARS.filter((year) => year > startingYear).map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </TextField>
            </div>
          )}
          {cityError && (
            <Alert severity="warning">
              The full city list couldn’t load. You can choose an available city
              or reload to try again.
            </Alert>
          )}
          {preparation.status === "loading" && (
            <div className="dataCenterSetupProgress" role="status">
              <CircularProgress size={24} />
              <Typography>Preparing your example grid…</Typography>
            </div>
          )}
          {preparation.status === "error" && (
            <Alert
              severity="error"
              action={
                <Button onClick={() => setAttempt((value) => value + 1)}>
                  Retry preparation
                </Button>
              }
            >
              We couldn’t prepare this grid. Try a smaller account count or
              retry.
            </Alert>
          )}
          {location && (
            <section
              className="dataCenterSetupSummary"
              aria-labelledby="data-center-demand-label"
              aria-live="polite"
            >
              <div className="dataCenterSetupControls">
                {customerProfile && (
                  <details className="dataCenterSetupAssumptions dataCenterSetupGridSize">
                    <summary>
                      {accountsInput !== undefined
                        ? "Your grid size"
                        : customerProfile.basis === "reference-utility"
                          ? "Example grid size"
                          : "Grid size"}
                      :{" "}
                      {validAccounts ? formatCount(startingCustomers!) : "edit"}{" "}
                      accounts · edit
                    </summary>
                    <TextField
                      label="Homes and businesses served"
                      type="number"
                      value={accountsInput ?? startingCustomers ?? ""}
                      slotProps={{
                        htmlInput: { min: 1, max: 100000000, step: 1 },
                      }}
                      error={!validAccounts}
                      helperText={
                        validAccounts
                          ? "Customer accounts, not population. Adjust to match the area you want to explore."
                          : "Enter a whole number from 1 to 100,000,000."
                      }
                      onChange={(event) => setAccountsInput(event.target.value)}
                    />
                    <Typography variant="body2" color="textSecondary">
                      {accountsInput !== undefined
                        ? `Published reference: ${formatCount(customerProfile.customers)} accounts from `
                        : customerProfile.basis === "reference-utility"
                          ? "Example size based on "
                          : "Based on "}
                      <a
                        href={customerProfile.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {customerProfile.serviceArea}
                      </a>
                      {customerProfile.sourceYear
                        ? ` (${customerProfile.sourceYear})`
                        : ""}
                      .
                    </Typography>
                  </details>
                )}

                <Typography
                  component="h2"
                  variant="h6"
                  id="data-center-demand-label"
                >
                  How much extra power?
                </Typography>
                {growthScenario && (
                  <div className="dataCenterSetupPower">
                    <Typography
                      component="strong"
                      color="primary"
                      className="dataCenterSetupPowerValue"
                    >
                      {formatDemandPower(demandW)}
                    </Typography>
                    <Slider
                      aria-label="Power needed"
                      value={demandTick}
                      min={ZERO_DEMAND_TICK}
                      max={MAX_DEMAND_TICK}
                      step={1}
                      marks={[
                        { value: ZERO_DEMAND_TICK, label: "0" },
                        {
                          value: MAX_DEMAND_TICK,
                          label: formatDemandPower(
                            demandAtTick(MAX_DEMAND_TICK),
                          ),
                        },
                      ]}
                      getAriaValueText={(tick) =>
                        formatDemandPower(demandAtTick(tick))
                      }
                      valueLabelFormat={(tick) =>
                        formatDemandPower(demandAtTick(tick))
                      }
                      valueLabelDisplay="auto"
                      onChange={(_event, value) =>
                        setDemandTick(Array.isArray(value) ? value[0] : value)
                      }
                    />
                  </div>
                )}
              </div>
              {growthScenario && (
                <>
                  <Typography
                    variant="body2"
                    color="textSecondary"
                    className="dataCenterSetupComparison"
                  >
                    To compare the difference, run again with 0 power needed.{" "}
                    Uses local weather and a regional power mix. This is an
                    example grid, not a forecast of your utility’s plans.
                  </Typography>
                  {growthScenario.facilities.some(
                    (facility) =>
                      facility.label === "Modeled balancing reserve",
                  ) && (
                    <Typography variant="body2" color="textSecondary">
                      Includes modeled gas backup where the game cannot
                      reproduce the regional supply.
                    </Typography>
                  )}
                  <details className="dataCenterSetupAssumptions">
                    <summary>Power sources and assumptions</summary>
                    <Typography variant="body2">
                      Explore {growthScenario.startingYear}–
                      {growthScenario.startingYear +
                        (scenario || growthScenario).durationMonths / 12}
                      .
                    </Typography>
                    <Typography variant="body2">
                      Power mix based on{" "}
                      {powerMix && (
                        <a
                          href={powerMix.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {powerMix.geography} capacity data ({powerMix.year})
                        </a>
                      )}
                      . Uses the region’s mix of power-generating equipment, not
                      its electricity output or your city’s actual power plants.
                      {powerMix && startingYear > powerMix.year
                        ? " Later starts use the latest available mix, not a prediction."
                        : ""}
                    </Typography>
                    <Typography variant="body2">
                      {powerMix?.geothermalSourceUrl && (
                        <>
                          <a
                            href={powerMix.geothermalSourceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            IRENA geothermal capacity data
                          </a>{" "}
                          supplements the regional source.{" "}
                        </>
                      )}
                      The model sizes the starting power plants to serve
                      existing demand, before your new data centers arrive.
                      Hydro is limited to known sites, and geothermal to
                      suitable locations; those limits can change the regional
                      mix. Gas is split between steady and quick-start plants.
                      Storage and unclassified sources are excluded.
                    </Typography>
                    <ul>
                      {growthScenario.facilities.map((facility, index) => (
                        <li key={`${facility.name}-${index}`}>
                          {facility.label
                            ? `${facility.label} (${facility.name})`
                            : facility.name ||
                              (facility.fuel === "Sun"
                                ? "Solar"
                                : facility.fuel === "Uranium"
                                  ? "Nuclear"
                                  : facility.fuel)}
                          : {formatWatts(facility.peakW || 0)}
                        </li>
                      ))}
                    </ul>
                    <Typography variant="body2">
                      Uses the model’s full costs and construction times.
                      Results help you explore tradeoffs, rather than predict a
                      specific project’s impact.
                    </Typography>
                  </details>
                </>
              )}
            </section>
          )}
        </div>
      </div>
      {scenario && (
        <footer className="dataCenterSetupFooter">
          <div className="dataCenterSetupStart">
            <Button
              variant="contained"
              color="primary"
              size="large"
              endIcon={<ArrowForwardIcon />}
              onClick={() => onStart(scenario)}
            >
              Start exploring
            </Button>
          </div>
        </footer>
      )}
    </div>
  );
}
