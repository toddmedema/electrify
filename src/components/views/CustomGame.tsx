import * as React from "react";
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Select,
  SelectChangeEvent,
  Slider,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIosIcon from "@mui/icons-material/ArrowBackIos";
import CasinoIcon from "@mui/icons-material/Casino";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import InfoIcon from "@mui/icons-material/Info";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import LocationPicker from "../base/LocationPicker";
import VictoryConditions from "../base/VictoryConditions";
import { DIFFICULTIES, DIFFICULTY_LABELS } from "../../Constants";
import { CityType, getCities, initCities } from "../../data/Cities";
import { GENERATORS, STORAGE } from "../../data/Facilities";
import { getViableLocationsRemaining } from "../../data/FacilitySites";
import { WEATHER_STARTING_YEAR } from "../../data/Weather";
import { getFuelEscalation } from "../../data/FuelPrices";
import { getStartingCustomers } from "../../data/LocationProfiles";
import { prefetchScenarioData } from "../../helpers/OfflineData";
import { createCustomGameForecastWorker } from "../../helpers/CustomGameForecastClient";
import {
  CustomGameForecastRequest,
  CustomGameForecastResponse,
  YearOneOutlook,
} from "../../helpers/CustomGameForecast";
import { getDateFromMinute } from "../../helpers/DateTime";
import { getScenarioLocation } from "../../helpers/Locations";
import {
  formatMoneyConcise,
  formatWattHours,
  formatWatts,
} from "../../helpers/Format";
import { formatPricePerLargeMass, largeMassUnit } from "../../helpers/Units";
import { useUnits } from "../base/UnitsContext";
import { newSeed } from "../../helpers/Math";
import {
  DifficultyType,
  FacilityShoppingType,
  GameType,
  ScenarioFacilityType,
  ScenarioType,
} from "../../Types";

export interface StateProps {
  game: GameType;
  scenario: ScenarioType;
}

export interface DispatchProps {
  onBack: () => void;
  onDelta: (delta: Partial<GameType>) => void;
  onStart: (scenario: ScenarioType) => void;
}

export interface Props extends StateProps, DispatchProps {}

// Only the floor is a real constraint: the recorded weather begins in WEATHER_STARTING_YEAR and
// the fuel prices in 1975, and a year before that has nothing to project forwards from. Forwards
// there is no limit - the weather forecast and the price projection both run indefinitely, so a
// 2100 start just plays eighty years of projection - and this is simply as far ahead as seemed
// worth offering. Stepped by decade because a dropdown is the wrong control for 121 rows.
const LATEST_STARTING_YEAR = 2100;
const STARTING_YEAR_STEP = 10;
const STARTING_YEARS = Array.from(
  {
    length:
      (LATEST_STARTING_YEAR - WEATHER_STARTING_YEAR) / STARTING_YEAR_STEP + 1,
  },
  (_v: unknown, i: number) => WEATHER_STARTING_YEAR + i * STARTING_YEAR_STEP,
);
const DURATION_YEARS = [1, 5, 10, 20, 40, 60, 100];
// The era the cash, rates and fees below are written in: amounts a player recognises, against the
// fuel prices the data ends on.
const MONEY_BASE_YEAR = 2020;
const FORECAST_DEBOUNCE_MS = 250;

type OutlookState =
  | { status: "loading" }
  | { status: "invalid" }
  | { status: "error" }
  | { status: "ready"; outlook: YearOneOutlook };

/**
 * A cash amount, rate or fee re-quoted into the money of the year the game starts in.
 *
 * Fuel is the one price the game reads at face value for the year it is in - build costs and O&M
 * are anchored on whatever year a game starts, so they always open at what the tables say. A 2080
 * game therefore opens against sixty years of escalated fuel, and offering it a literal seven
 * cents a kilowatt hour is offering a game that is bankrupt inside a quarter.
 *
 * Only forwards. A game starting before MONEY_BASE_YEAR is played against real recorded prices
 * rather than a projection, so there is no escalation to undo, and deflating those rates would
 * change every historical scenario's balance for no reason.
 */
function inEraMoney(base: number, startingYear: number): number {
  const factor =
    getFuelEscalation(Math.max(startingYear, MONEY_BASE_YEAR)) /
    getFuelEscalation(MONEY_BASE_YEAR);
  // Two significant figures, so the offered numbers stay round enough to choose between
  return Number((base * factor).toPrecision(2));
}

// The option nearest a value, used to keep the player's position in a list when the era under it
// moves.
function nearestIndex(options: number[], value: number): number {
  let best = 0;
  options.forEach((option: number, i: number) => {
    if (Math.abs(option - value) < Math.abs(options[best] - value)) {
      best = i;
    }
  });
  return best;
}

const STARTING_CASH = [100000000, 200000000, 500000000, 1000000000];
const RATES_PER_KWH = [0.05, 0.07, 0.1, 0.15];
const FEES_PER_TON = [0, 20, 50, 100];
const GENERATOR_SIZES_W = [
  100000000, 250000000, 500000000, 1000000000, 2000000000,
];
const STORAGE_SIZES_WH = [100000000, 500000000, 1000000000, 2000000000];

interface TechnologyType {
  name: string;
  storage: boolean;
  maxSize: number; // maxPeakW for generators, maxPeakWh for storage
}

/**
 * The technologies buildable in a given year, straight from the same functions initGame resolves
 * starting facilities against - so the picker can't offer something that would be silently dropped
 * on the way into the game (no solar before 1982, no batteries before 2008, and so on).
 */
function technologiesFor(
  scenario: ScenarioType,
  difficulty: DifficultyType,
): TechnologyType[] {
  // Only the fields those two read; a full game state doesn't exist yet at setup time
  const state = {
    date: getDateFromMinute(0, scenario.startingYear),
    startingYear: scenario.startingYear,
    difficulty,
    feePerKgCO2e: scenario.feePerKgCO2e,
    seed: 0,
    facilities: [],
    location: getScenarioLocation(scenario),
  } as unknown as GameType;
  // GENERATORS and STORAGE have already filtered out whatever isn't available in the year
  return [
    ...GENERATORS(state, GENERATOR_SIZES_W[0], [], []).map(
      (g: FacilityShoppingType) => ({
        name: g.name,
        storage: false,
        maxSize: g.maxPeakW,
      }),
    ),
    ...STORAGE(state, STORAGE_SIZES_WH[0]).map((s: FacilityShoppingType) => ({
      name: s.name,
      storage: true,
      maxSize: s.maxPeakWh,
    })),
    // A technology can be available in a year and still cap out below the smallest plant on
    // offer - batteries were 50MWh-scale in 2010 - which would leave nothing to pick
  ].filter(
    (t: TechnologyType) =>
      t.maxSize >= (t.storage ? STORAGE_SIZES_WH : GENERATOR_SIZES_W)[0],
  );
}

function facilityName(facility: Partial<FacilityShoppingType>): string {
  return (facility.name as string) || "";
}

function facilitySize(facility: Partial<FacilityShoppingType>): string {
  return facility.peakWh
    ? formatWattHours(facility.peakWh)
    : formatWatts(facility.peakW || 0);
}

function demandServedLabel(outlook: YearOneOutlook): string {
  if (outlook.worstShortfallW === 0) {
    return "100%";
  }
  // Never round a real deficit up to the covered state's 100%.
  const percent = Math.min(99.9, outlook.demandServed * 100);
  return `${percent >= 99 ? percent.toFixed(1) : Math.round(percent)}%`;
}

/**
 * Keep the starting fleet's nameplate capacity per customer constant as its customer base moves.
 * The default 500 MW plant for one million customers covers the opening demand plus the game's
 * 5% reserve margin; scaling every starting generator together preserves that coverage and the
 * player's chosen generation mix. Storage is energy capacity rather than firm generation, so it
 * stays at the size the player selected.
 */
function facilitiesForStartingCustomers(
  scenario: ScenarioType,
  startingCustomers: number,
): ScenarioFacilityType[] {
  const previousCustomers =
    scenario.startingCustomers ||
    getStartingCustomers(getScenarioLocation(scenario));
  if (previousCustomers <= 0 || previousCustomers === startingCustomers) {
    return scenario.facilities;
  }
  const scale = startingCustomers / previousCustomers;
  return scenario.facilities.map((facility: ScenarioFacilityType) =>
    facility.peakW && !facility.peakWh
      ? { ...facility, peakW: Math.round(facility.peakW * scale) }
      : facility,
  );
}

export default function CustomGame(props: Props): React.JSX.Element {
  const { game, onBack, onDelta, onStart } = props;
  const units = useUnits();
  const [scenario, setScenario] = React.useState<ScenarioType>(props.scenario);
  const [victoryDialogOpen, setVictoryDialogOpen] = React.useState(false);
  const [feeDialogOpen, setFeeDialogOpen] = React.useState(false);
  const [addName, setAddName] = React.useState("");
  const [addSize, setAddSize] = React.useState(GENERATOR_SIZES_W[2]);
  const previewSeed = React.useRef(scenario.seed ?? newSeed());
  const forecastRequestId = React.useRef(0);
  const forecastWorker = React.useRef<Worker>();
  const [outlook, setOutlook] = React.useState<OutlookState>({
    status: "loading",
  });
  const ensureForecastWorker = React.useCallback(() => {
    if (forecastWorker.current) {
      return forecastWorker.current;
    }
    const worker = createCustomGameForecastWorker();
    forecastWorker.current = worker;
    worker.onmessage = (event: MessageEvent<CustomGameForecastResponse>) => {
      if (event.data.requestId !== forecastRequestId.current) {
        return;
      }
      if ("outlook" in event.data) {
        setOutlook({ status: "ready", outlook: event.data.outlook });
      } else {
        setOutlook({ status: "error" });
      }
    };
    worker.onerror = (event: ErrorEvent) => {
      // The outlook is optional. Handle a worker failure without making the setup unusable.
      event.preventDefault();
      setOutlook({ status: "error" });
    };
    return worker;
  }, []);
  React.useEffect(() => {
    return () => {
      const worker = forecastWorker.current;
      forecastWorker.current = undefined;
      worker?.terminate();
    };
  }, []);

  const technologies = React.useMemo(
    () => technologiesFor(scenario, game.difficulty),
    [scenario, game.difficulty],
  );
  const adding = technologies.find((t) => t.name === addName);
  const sizes = (adding?.storage ? STORAGE_SIZES_WH : GENERATOR_SIZES_W).filter(
    (size) => !adding || size <= adding.maxSize,
  );
  // What the utility starts with, what a kilowatt hour may be charged at, and what a ton of CO2e
  // may be feed, in the money of the year the game starts in. All move with the starting year,
  // which is why changing that year has to re-quote whatever was already chosen rather than
  // leaving a 2020 amount on a 2080 game -- see changeStartingYear below.
  const cashOptions = React.useMemo(
    () =>
      STARTING_CASH.map((cash: number) =>
        inEraMoney(cash, scenario.startingYear),
      ),
    [scenario.startingYear],
  );
  const rateOptions = React.useMemo(
    () =>
      RATES_PER_KWH.map((r: number) => inEraMoney(r, scenario.startingYear)),
    [scenario.startingYear],
  );
  const feeOptions = React.useMemo(
    () => FEES_PER_TON.map((f: number) => inEraMoney(f, scenario.startingYear)),
    [scenario.startingYear],
  );

  // Every place that can be picked: the six in the bundle to begin with, and every city with
  // downloaded weather once the index arrives, which is a download rather than a rebuild
  const [cities, setCities] = React.useState<CityType[]>(getCities);
  const [citiesLoading, setCitiesLoading] = React.useState(true);
  React.useEffect(() => {
    let live = true;
    initCities().then((loaded: CityType[]) => {
      if (live) {
        setCities(loaded);
        setCitiesLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  // Plus, if the scenario is being played somewhere the index doesn't list, that place too -- a
  // custom game may carry a location no catalogue has heard of, and a picker whose value isn't
  // one of its options renders blank and drops the choice on the next edit. Listed last, under
  // its own heading, so it doesn't shuffle the rest of the list around.
  const current = getScenarioLocation(scenario);
  React.useEffect(() => {
    if (current) {
      void prefetchScenarioData(current);
    }
  }, [current]);
  const selectableLocations = React.useMemo(
    () =>
      current && !cities.some((c: CityType) => c.id === current.id)
        ? [...cities, { ...current, region: "Custom" }]
        : cities,
    [current, cities],
  );
  const location = selectableLocations.find(
    (c: CityType) => c.id === current?.id,
  );

  // Rolling the year back past a technology's invention would otherwise leave a facility in the
  // list that quietly disappears once the game loads
  const claimedSites: Array<{ name: string }> = [];
  const unavailable = scenario.facilities.filter(
    (f: Partial<FacilityShoppingType>) => {
      const name = facilityName(f);
      if (!technologies.some((t) => t.name === name)) {
        return true;
      }
      const sitesRemaining = getViableLocationsRemaining(
        location,
        claimedSites,
        name,
      );
      claimedSites.push({ name });
      return sitesRemaining === 0;
    },
  );

  React.useEffect(() => {
    const requestId = ++forecastRequestId.current;
    if (unavailable.length > 0) {
      setOutlook({ status: "invalid" });
      return;
    }
    const location = getScenarioLocation(scenario);
    if (!location) {
      setOutlook({ status: "error" });
      return;
    }

    setOutlook({ status: "loading" });
    const timer = window.setTimeout(() => {
      const request: CustomGameForecastRequest = {
        requestId,
        scenario: {
          ...scenario,
          locationId: location.id,
          location,
        },
        difficulty: game.difficulty,
        seed: scenario.seed ?? previewSeed.current,
      };
      ensureForecastWorker().postMessage(request);
    }, FORECAST_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [ensureForecastWorker, game.difficulty, scenario, unavailable.length]);

  const change = (delta: Partial<ScenarioType>) => {
    setScenario({ ...scenario, ...delta });
  };

  const changeStartingCustomers = (
    startingCustomers: number,
    delta: Partial<ScenarioType> = {},
  ) => {
    setScenario((currentScenario: ScenarioType) => ({
      ...currentScenario,
      ...delta,
      startingCustomers,
      facilities: facilitiesForStartingCustomers(
        currentScenario,
        startingCustomers,
      ),
    }));
  };

  /**
   * Moving the game's era, and carrying the prices that are quoted in it along.
   *
   * The player picked "the cheapest rate" or "the middling carbon fee", not a literal number of
   * cents, so the same position in each list is what survives the move. Rolling 2020 forward to
   * 2080 and leaving seven cents behind would silently hand back a game that cannot be won.
   */
  const changeStartingYear = (startingYear: number) => {
    const cash = nearestIndex(cashOptions, scenario.cash);
    const rate = nearestIndex(rateOptions, scenario.dollarsPerkWh);
    const fee = nearestIndex(feeOptions, scenario.feePerKgCO2e * 1000);
    change({
      startingYear,
      cash: inEraMoney(STARTING_CASH[cash], startingYear),
      dollarsPerkWh: inEraMoney(RATES_PER_KWH[rate], startingYear),
      feePerKgCO2e: inEraMoney(FEES_PER_TON[fee], startingYear) / 1000,
    });
  };

  const addFacility = () => {
    if (!adding) {
      return;
    }
    const facility = adding.storage
      ? { name: adding.name, peakWh: addSize }
      : { name: adding.name, peakW: addSize };
    change({ facilities: [...scenario.facilities, facility] });
  };

  const removeFacility = (index: number) => {
    change({
      facilities: scenario.facilities.filter(
        (_f: Partial<FacilityShoppingType>, i: number) => i !== index,
      ),
    });
  };

  return (
    <div id="listCard" className="flexContainer">
      <div id="topbar">
        <Toolbar>
          <IconButton
            onClick={onBack}
            aria-label="back"
            edge="start"
            color="primary"
            size="large"
          >
            <ArrowBackIosIcon />
          </IconButton>
          <Typography variant="h6">Custom setup</Typography>
        </Toolbar>
      </div>

      <div className="scrollable">
        <LocationPicker
          locations={selectableLocations}
          value={location}
          loading={citiesLoading}
          onChange={(picked: CityType) => {
            changeStartingCustomers(getStartingCustomers(picked), {
              locationId: picked.id,
              location: picked,
            });
          }}
        />
        <div className="customSetupColumns">
          <section
            className="customSetupSettings"
            aria-labelledby="custom-setup-settings-heading"
          >
            <Typography
              id="custom-setup-settings-heading"
              variant="h6"
              component="h2"
              className="customSetupSectionHeading"
            >
              Game setup
            </Typography>
            <Table size="small" id="gameSetupTable">
              <TableBody>
                <TableRow>
                  <TableCell>Customers</TableCell>
                  <TableCell>
                    <Slider
                      aria-label="Starting customers"
                      min={100000}
                      max={5000000}
                      step={50000}
                      value={
                        scenario.startingCustomers ||
                        getStartingCustomers(getScenarioLocation(scenario))
                      }
                      valueLabelDisplay="auto"
                      valueLabelFormat={(value: number) =>
                        value.toLocaleString()
                      }
                      onChange={(_event: Event, value: number | number[]) =>
                        changeStartingCustomers(
                          Array.isArray(value) ? value[0] : value,
                        )
                      }
                    />
                    <Typography variant="caption" color="textSecondary">
                      {(
                        scenario.startingCustomers ||
                        getStartingCustomers(getScenarioLocation(scenario))
                      ).toLocaleString()}
                    </Typography>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Start year</TableCell>
                  <TableCell>
                    <Select
                      id="startingYear"
                      inputProps={{ "aria-label": "Starting year" }}
                      value={scenario.startingYear}
                      onChange={(e: SelectChangeEvent<number>) =>
                        changeStartingYear(Number(e.target.value))
                      }
                    >
                      {STARTING_YEARS.map((y: number) => {
                        return (
                          <MenuItem value={y} key={y}>
                            {y}
                          </MenuItem>
                        );
                      })}
                    </Select>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Duration</TableCell>
                  <TableCell>
                    <Select
                      id="duration"
                      inputProps={{ "aria-label": "Duration" }}
                      value={scenario.durationMonths}
                      onChange={(e: SelectChangeEvent<number>) =>
                        change({ durationMonths: Number(e.target.value) })
                      }
                    >
                      {DURATION_YEARS.map((y: number) => {
                        return (
                          <MenuItem value={y * 12} key={y}>
                            {y} {y === 1 ? "year" : "years"}
                          </MenuItem>
                        );
                      })}
                    </Select>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    Ownership&nbsp;
                    <IconButton
                      onClick={() => setVictoryDialogOpen(true)}
                      aria-label="Victory conditions"
                      color="primary"
                      size="small"
                    >
                      <InfoIcon />
                    </IconButton>
                  </TableCell>
                  <TableCell>
                    <Select
                      id="ownership"
                      inputProps={{ "aria-label": "Ownership" }}
                      value={scenario.ownership}
                      onChange={(
                        e: SelectChangeEvent<ScenarioType["ownership"]>,
                      ) =>
                        change({
                          ownership: e.target
                            .value as ScenarioType["ownership"],
                        })
                      }
                    >
                      <MenuItem value="Investor">
                        Investor-owned utility
                      </MenuItem>
                      <MenuItem value="Public">Publicly owned utility</MenuItem>
                    </Select>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Cash</TableCell>
                  <TableCell>
                    <Select
                      id="cash"
                      inputProps={{ "aria-label": "Starting cash" }}
                      value={scenario.cash}
                      onChange={(e: SelectChangeEvent<number>) =>
                        change({ cash: Number(e.target.value) })
                      }
                    >
                      {cashOptions.map((c: number) => {
                        return (
                          <MenuItem value={c} key={c}>
                            {formatMoneyConcise(c)}
                          </MenuItem>
                        );
                      })}
                    </Select>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Electricity rate</TableCell>
                  <TableCell>
                    <Select
                      id="dollarsPerkWh"
                      inputProps={{ "aria-label": "Electricity rate" }}
                      value={scenario.dollarsPerkWh}
                      onChange={(e: SelectChangeEvent<number>) =>
                        change({ dollarsPerkWh: Number(e.target.value) })
                      }
                    >
                      {rateOptions.map((r: number) => {
                        return (
                          <MenuItem value={r} key={r}>
                            ${r.toFixed(2)}/kWh
                          </MenuItem>
                        );
                      })}
                    </Select>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    Carbon fee&nbsp;
                    <IconButton
                      onClick={() => setFeeDialogOpen(true)}
                      aria-label="What is a carbon fee?"
                      color="primary"
                      size="small"
                    >
                      <InfoIcon />
                    </IconButton>
                  </TableCell>
                  <TableCell>
                    <Select
                      id="feePerKgCO2e"
                      inputProps={{ "aria-label": "Carbon fee" }}
                      value={scenario.feePerKgCO2e}
                      onChange={(e: SelectChangeEvent<number>) =>
                        change({ feePerKgCO2e: Number(e.target.value) })
                      }
                    >
                      {feeOptions.map((f: number) => {
                        return (
                          <MenuItem value={f / 1000} key={f}>
                            {/* The options are set per tonne, and the value stays per kilogram
                            whichever way it is quoted - only the label moves */}
                            {formatPricePerLargeMass(f / 1000, units)}
                          </MenuItem>
                        );
                      })}
                    </Select>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Difficulty</TableCell>
                  <TableCell>
                    {/* Difficulty lives on the game rather than the scenario, the same way it does
                    on the scenario details screen */}
                    <Select
                      id="difficulty"
                      inputProps={{ "aria-label": "Difficulty" }}
                      value={game.difficulty}
                      onChange={(e: SelectChangeEvent<DifficultyType>) =>
                        onDelta({
                          difficulty: e.target.value as DifficultyType,
                        })
                      }
                    >
                      {Object.keys(DIFFICULTIES).map((d: string) => {
                        return (
                          <MenuItem value={d} key={d}>
                            <Tooltip
                              title={DIFFICULTIES[d].description}
                              placement="right"
                            >
                              <span>
                                {DIFFICULTY_LABELS[d as DifficultyType]}
                              </span>
                            </Tooltip>
                          </MenuItem>
                        );
                      })}
                    </Select>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Seed</TableCell>
                  <TableCell>
                    {/* Everything random in a run - weather, fuel prices - comes from the seed, so
                    the same seed and settings replay the same game */}
                    <TextField
                      id="seed"
                      variant="standard"
                      placeholder="Random"
                      slotProps={{ htmlInput: { "aria-label": "Seed" } }}
                      value={scenario.seed === undefined ? "" : scenario.seed}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const digits = e.target.value.replace(/[^0-9]/g, "");
                        change({
                          seed: digits === "" ? undefined : Number(digits),
                        });
                      }}
                    />
                    <IconButton
                      onClick={() => change({ seed: newSeed() })}
                      aria-label="Random seed"
                      color="primary"
                      size="small"
                    >
                      <CasinoIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </section>

          <section
            className="customSetupFacilities"
            aria-labelledby="custom-setup-facilities-heading"
          >
            <Typography
              id="custom-setup-facilities-heading"
              variant="h6"
              component="h2"
              className="customSetupSectionHeading"
            >
              Facilities
            </Typography>
            {unavailable.length > 0 && (
              <Typography variant="body2" color="error">
                {unavailable.map(facilityName).join(", ")} can't be built with
                this location and year, or exceeds the number of suitable build
                sites. Remove {unavailable.length === 1 ? "it" : "them"} or
                change the setup.
              </Typography>
            )}

            <section
              className={`customSetupOutlook customSetupOutlook-${outlook.status}${
                outlook.status === "ready"
                  ? outlook.outlook.worstShortfallW > 0
                    ? " customSetupOutlook-deficit"
                    : " customSetupOutlook-covered"
                  : ""
              }`}
              aria-labelledby="custom-setup-outlook-heading"
              aria-busy={outlook.status === "loading"}
            >
              <Typography
                id="custom-setup-outlook-heading"
                variant="subtitle2"
                component="h3"
              >
                Year 1 outlook
              </Typography>
              <div role="status" aria-live="polite" aria-atomic="true">
                {outlook.status === "loading" && (
                  <Typography variant="body2">
                    Calculating Year 1 outlook…
                  </Typography>
                )}
                {outlook.status === "invalid" && (
                  <Typography variant="body2">
                    Fix the facility issue to calculate an outlook.
                  </Typography>
                )}
                {outlook.status === "error" && (
                  <Typography variant="body2">
                    Year 1 outlook unavailable.
                  </Typography>
                )}
                {outlook.status === "ready" && (
                  <>
                    <div className="customSetupOutlookState">
                      {outlook.outlook.worstShortfallW > 0 ? (
                        <WarningAmberIcon fontSize="small" aria-hidden="true" />
                      ) : (
                        <CheckCircleOutlineIcon
                          fontSize="small"
                          aria-hidden="true"
                        />
                      )}
                      <strong>
                        {outlook.outlook.worstShortfallW > 0
                          ? "Deficit forecast"
                          : "Demand covered"}
                      </strong>
                    </div>
                    <div className="customSetupOutlookMetrics">
                      <div>
                        <strong>{demandServedLabel(outlook.outlook)}</strong>
                        <span>annual demand served</span>
                      </div>
                      <div>
                        <strong>
                          {outlook.outlook.worstShortfallW > 0
                            ? `Up to ${formatWatts(outlook.outlook.worstShortfallW)} short`
                            : "No forecast shortfall"}
                        </strong>
                      </div>
                    </div>
                    <Typography
                      variant="caption"
                      className="customSetupOutlookAssumption"
                    >
                      Assumes this fleet and rate stay unchanged.
                    </Typography>
                  </>
                )}
              </div>
            </section>

            {scenario.facilities.map(
              (f: Partial<FacilityShoppingType>, i: number) => {
                return (
                  <Card
                    className="build-list-item"
                    key={`${facilityName(f)}${i}`}
                  >
                    <CardHeader
                      title={facilityName(f)}
                      subheader={facilitySize(f)}
                      action={
                        <IconButton
                          onClick={() => removeFacility(i)}
                          aria-label={`Remove ${facilityName(f)}`}
                          color="primary"
                          size="large"
                        >
                          <DeleteIcon />
                        </IconButton>
                      }
                    />
                  </Card>
                );
              },
            )}

            <div className="customFacilityPicker">
              <Select
                id="addFacilityName"
                inputProps={{ "aria-label": "Facility type" }}
                displayEmpty
                value={adding ? adding.name : ""}
                onChange={(e: SelectChangeEvent<string>) => {
                  const next = technologies.find(
                    (t) => t.name === e.target.value,
                  );
                  setAddName(e.target.value);
                  // Sizes differ between generators and storage, so carrying the old one over would
                  // offer a watt-hour capacity for a generator. Opens on a middling plant rather
                  // than the biggest one the year allows, which is a lot to hand someone by default
                  if (next) {
                    const options = (
                      next.storage ? STORAGE_SIZES_WH : GENERATOR_SIZES_W
                    ).filter((s) => s <= next.maxSize);
                    setAddSize(
                      options[
                        Math.min(next.storage ? 1 : 2, options.length - 1)
                      ],
                    );
                  }
                }}
              >
                <MenuItem value="" disabled>
                  Add a facility
                </MenuItem>
                {technologies.map((t: TechnologyType) => {
                  return (
                    <MenuItem value={t.name} key={t.name}>
                      {t.name}
                    </MenuItem>
                  );
                })}
              </Select>
              <Select
                id="addFacilitySize"
                inputProps={{ "aria-label": "Facility size" }}
                value={sizes.indexOf(addSize) === -1 ? sizes[0] : addSize}
                disabled={!adding}
                onChange={(e: SelectChangeEvent<number>) =>
                  setAddSize(Number(e.target.value))
                }
              >
                {sizes.map((size: number) => {
                  return (
                    <MenuItem value={size} key={size}>
                      {adding?.storage
                        ? formatWattHours(size)
                        : formatWatts(size)}
                    </MenuItem>
                  );
                })}
              </Select>
              <IconButton
                onClick={addFacility}
                aria-label="Add facility"
                color="primary"
                disabled={!adding}
                size="large"
              >
                <AddIcon />
              </IconButton>
            </div>
          </section>
        </div>

        <div className="customSetupActions">
          <Button
            size="large"
            variant="contained"
            color="primary"
            disabled={unavailable.length > 0}
            onClick={() =>
              onStart({
                ...scenario,
                seed: scenario.seed ?? previewSeed.current,
              })
            }
          >
            Play
          </Button>
        </div>
      </div>

      <Dialog
        open={victoryDialogOpen}
        onClose={() => setVictoryDialogOpen(false)}
      >
        <DialogTitle>
          Victory Conditions: {scenario.ownership}-Owned
          <IconButton
            aria-label="close"
            onClick={() => setVictoryDialogOpen(false)}
            className="top-right"
            size="large"
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <VictoryConditions
            ownership={scenario.ownership}
            dollarsPerkWh={scenario.dollarsPerkWh}
            minimumCustomerRetention={scenario.minimumCustomerRetention}
            reliabilityObjective={scenario.reliabilityObjective}
          />
        </DialogContent>
        <DialogActions>
          <Button
            color="primary"
            variant="contained"
            onClick={() => setVictoryDialogOpen(false)}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={feeDialogOpen} onClose={() => setFeeDialogOpen(false)}>
        <DialogTitle>Carbon fee</DialogTitle>
        <DialogContent>
          A carbon fee charges for greenhouse gas emissions. The game measures
          them in {largeMassUnit(units)} of carbon dioxide equivalent (CO2e), a
          common unit for comparing different greenhouse gases.
        </DialogContent>
        <DialogActions>
          <Button
            color="primary"
            variant="contained"
            onClick={() => setFeeDialogOpen(false)}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
