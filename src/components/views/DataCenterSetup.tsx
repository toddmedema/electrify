import * as React from "react";
import {
  Alert,
  Autocomplete,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  TextField,
  Typography,
} from "@mui/material";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import { CityType, getCities, initCities } from "../../data/Cities";
import { withoutDataCenterGrowth } from "../../helpers/DataCenterScenario";
import {
  DataCenterSetupRequest,
  DataCenterSetupResponse,
} from "../../helpers/DataCenterSetup";
import { createDataCenterSetupWorker } from "../../helpers/DataCenterSetupClient";
import { formatCount, formatWatts } from "../../helpers/Format";
import { prefetchScenarioData } from "../../helpers/OfflineData";
import { ScenarioType } from "../../Types";
import ScreenHeader from "../base/ScreenHeader";
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

function cityLabel(city: CityType): string {
  return [city.name, city.admin, city.country]
    .filter(
      (part, index) => !!part && (index === 0 || !city.name.includes(part)),
    )
    .join(", ");
}

export default function DataCenterSetup({ onBack, onStart }: Props) {
  const [startingYear] = React.useState(() => new Date().getFullYear());
  const [cities, setCities] = React.useState(getCities);
  const [loading, setLoading] = React.useState(true);
  const [cityError, setCityError] = React.useState(false);
  const [location, setLocation] = React.useState<CityType | null>(null);
  const [includeGrowth, setIncludeGrowth] = React.useState(true);
  const [attempt, setAttempt] = React.useState(0);

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
    location
      ? {
          key: `${location.id}:${startingYear}:${attempt}`,
          scope: location,
          message: (requestId: number): DataCenterSetupRequest => ({
            requestId,
            location,
            startingYear,
          }),
        }
      : undefined,
    SETUP_WORKER,
  );
  const growthScenario =
    preparation.status === "ready" ? preparation.result : undefined;
  const scenario = React.useMemo(
    () =>
      growthScenario &&
      (includeGrowth
        ? growthScenario
        : withoutDataCenterGrowth(growthScenario)),
    [growthScenario, includeGrowth],
  );
  const additions = growthScenario?.loadAdditions?.filter(
    (load) => load.demandType === "Data Centers",
  );
  const firstConnection = additions?.length
    ? Math.min(...additions.map((load) => load.startsYear))
    : undefined;
  const addedDemand = additions?.reduce((total, load) => total + load.peakW, 0);

  return (
    <div id="listCard" className="flexContainer screenDataCenterSetup">
      <ScreenHeader title="Explore data-center growth" onBack={onBack} />
      <div className="scrollable">
        <div className="dataCenterSetupContent">
          <div className="dataCenterSetupIntro">
            <Typography component="h2" variant="h4">
              Start with your community
            </Typography>
            <Typography color="textSecondary">
              Choose a nearby city. We’ll prepare an example grid so you can
              explore what happens when data centers need more power.
            </Typography>
          </div>
          <Autocomplete
            options={cities}
            value={location}
            loading={loading}
            getOptionLabel={cityLabel}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            onChange={(_event, selected) => setLocation(selected)}
            noOptionsText="Try another nearby city"
            renderInput={(params) => (
              <TextField
                {...params}
                label="Choose a nearby city"
                placeholder="Search by city, state, or country"
                helperText="Choose the closest available city if yours isn’t listed."
              />
            )}
          />
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
              We couldn’t prepare this grid. Check your connection and try
              again.
            </Alert>
          )}
          {scenario && location && (
            <section
              className="dataCenterSetupSummary"
              aria-labelledby="data-center-grid-heading"
              aria-live="polite"
            >
              <Typography
                component="h2"
                variant="h6"
                id="data-center-grid-heading"
              >
                Your starting grid is ready
              </Typography>
              <Typography color="textSecondary">
                Starts in {scenario.startingYear} ·{" "}
                {scenario.durationMonths / 12}
                -year simulation
              </Typography>
              <dl className="dataCenterSetupFacts">
                <div>
                  <dt>Example grid size</dt>
                  <dd>
                    {formatCount(scenario.startingCustomers || 0)} customer
                    accounts
                  </dd>
                </div>
                <div>
                  <dt>Starting power sources</dt>
                  <dd>
                    {Array.from(
                      new Set(
                        scenario.facilities.map((facility) =>
                          facility.fuel === "Sun"
                            ? "Solar"
                            : facility.fuel || facility.name,
                        ),
                      ),
                    ).join(", ")}
                  </dd>
                </div>
                <div>
                  <dt>New data-center demand</dt>
                  <dd>
                    {includeGrowth
                      ? `${formatWatts(addedDemand || 0)}, arriving from ${firstConnection}`
                      : "None added in this comparison"}
                  </dd>
                </div>
              </dl>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={includeGrowth}
                    onChange={(_event, checked) => setIncludeGrowth(checked)}
                  />
                }
                label="Add data-center growth"
              />
              <Typography
                variant="body2"
                color="textSecondary"
                className="dataCenterSetupComparison"
              >
                To compare, return here, choose the same city, and switch this
                off. The starting grid, weather, and fuel prices stay the same.
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Uses local weather and regional assumptions, not your utility’s
                actual grid.
              </Typography>
              <details className="dataCenterSetupAssumptions">
                <summary>See the assumptions</summary>
                <Typography variant="body2">
                  Customer accounts represent homes and businesses, not
                  population. The starting power mix is an example, not a local
                  plant inventory.
                </Typography>
                <ul>
                  {scenario.facilities.map((facility, index) => (
                    <li key={`${facility.name}-${index}`}>
                      {facility.name ||
                        (facility.fuel === "Sun" ? "Solar" : facility.fuel)}
                      : {formatWatts(facility.peakW || 0)}
                    </li>
                  ))}
                </ul>
                <Typography variant="body2">
                  Uses the model’s full costs and construction times. Results
                  help you explore tradeoffs, rather than predict a specific
                  project’s impact.
                </Typography>
              </details>
            </section>
          )}
        </div>
      </div>
      <footer className="dataCenterSetupFooter">
        <div className="dataCenterSetupStart">
          <Button
            variant="contained"
            color="primary"
            size="large"
            disabled={!scenario}
            endIcon={<ArrowForwardIcon />}
            onClick={() => scenario && onStart(scenario)}
          >
            Start exploring
          </Button>
          <Typography variant="body2" color="textSecondary">
            Try clean energy choices. See costs, reliability, and emissions
            change.
          </Typography>
        </div>
      </footer>
    </div>
  );
}
