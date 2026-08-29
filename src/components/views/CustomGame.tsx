import * as React from "react";
import {
  Autocomplete,
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
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import InfoIcon from "@mui/icons-material/Info";
import VictoryConditions from "../base/VictoryConditions";
import { DIFFICULTIES } from "../../Constants";
import { CityType, getCities, initCities } from "../../data/Cities";
import { GENERATORS, STORAGE } from "../../data/Facilities";
import { getViableLocationCount } from "../../data/FacilitySites";
import { WEATHER_STARTING_YEAR } from "../../data/Weather";
import { getFuelEscalation } from "../../data/FuelPrices";
import { getStartingCustomers } from "../../data/LocationProfiles";
import { prefetchScenarioData } from "../../helpers/OfflineData";
import { getDateFromMinute } from "../../helpers/DateTime";
import { getScenarioLocation } from "../../helpers/Locations";
import { formatWattHours, formatWatts } from "../../helpers/Format";
import { formatPricePerLargeMass, largeMassUnit } from "../../helpers/Units";
import { useUnits } from "../base/UnitsContext";
import { newSeed } from "../../helpers/Math";
import {
  DifficultyType,
  FacilityShoppingType,
  GameType,
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
// The era the rates and fees above are written in: cents per kilowatt hour a player recognises,
// against the fuel prices the data ends on.
const RATE_BASE_YEAR = 2020;

/**
 * A rate or a fee re-quoted into the money of the year the game starts in.
 *
 * Fuel is the one price the game reads at face value for the year it is in - build costs and O&M
 * are anchored on whatever year a game starts, so they always open at what the tables say. A 2080
 * game therefore opens against sixty years of escalated fuel, and offering it a literal seven
 * cents a kilowatt hour is offering a game that is bankrupt inside a quarter.
 *
 * Only forwards. A game starting before RATE_BASE_YEAR is played against real recorded prices
 * rather than a projection, so there is no escalation to undo, and deflating those rates would
 * change every historical scenario's balance for no reason.
 */
function inEraMoney(base: number, startingYear: number): number {
  const factor =
    getFuelEscalation(Math.max(startingYear, RATE_BASE_YEAR)) /
    getFuelEscalation(RATE_BASE_YEAR);
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

export default function CustomGame(props: Props): React.JSX.Element {
  const { game, onBack, onDelta, onStart } = props;
  const units = useUnits();
  const [scenario, setScenario] = React.useState<ScenarioType>(props.scenario);
  const [victoryDialogOpen, setVictoryDialogOpen] = React.useState(false);
  const [feeDialogOpen, setFeeDialogOpen] = React.useState(false);
  const [addName, setAddName] = React.useState("");
  const [addSize, setAddSize] = React.useState(GENERATOR_SIZES_W[2]);

  const technologies = React.useMemo(
    () => technologiesFor(scenario, game.difficulty),
    [scenario, game.difficulty],
  );
  const adding = technologies.find((t) => t.name === addName);
  const sizes = (adding?.storage ? STORAGE_SIZES_WH : GENERATOR_SIZES_W).filter(
    (size) => !adding || size <= adding.maxSize,
  );
  // What a kilowatt hour may be charged at, and what a ton of CO2e may be feed, in the money of
  // the year the game starts in. Both move with the starting year, which is why changing that
  // year has to re-quote whatever was already chosen rather than leaving a 2020 rate on a 2080
  // game -- see changeStartingYear below.
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
  React.useEffect(() => {
    let live = true;
    initCities().then((loaded: CityType[]) => {
      if (live) {
        setCities(loaded);
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
  const usedSites = new Map<string, number>();
  const unavailable = scenario.facilities.filter(
    (f: Partial<FacilityShoppingType>) => {
      const name = facilityName(f);
      if (!technologies.some((t) => t.name === name)) {
        return true;
      }
      const used = (usedSites.get(name) || 0) + 1;
      usedSites.set(name, used);
      const sites = getViableLocationCount(location, name);
      return sites !== undefined && used > sites;
    },
  );

  const change = (delta: Partial<ScenarioType>) => {
    setScenario({ ...scenario, ...delta });
  };

  /**
   * Moving the game's era, and carrying the prices that are quoted in it along.
   *
   * The player picked "the cheapest rate" or "the middling carbon fee", not a literal number of
   * cents, so the same position in each list is what survives the move. Rolling 2020 forward to
   * 2080 and leaving seven cents behind would silently hand back a game that cannot be won.
   */
  const changeStartingYear = (startingYear: number) => {
    const rate = nearestIndex(rateOptions, scenario.dollarsPerkWh);
    const fee = nearestIndex(feeOptions, scenario.feePerKgCO2e * 1000);
    change({
      startingYear,
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
          <Typography variant="h6">Custom Game Setup</Typography>
        </Toolbar>
      </div>

      <div className="scrollable">
        <Table size="small" id="gameSetupTable">
          <TableBody>
            <TableRow>
              <TableCell>Location</TableCell>
              <TableCell>
                {/* The scenario carries the whole location rather than just its id, so a custom
                    game stays playable even if the catalogue it was picked from changes
                    underneath it - and so it can hold somewhere the catalogue never listed.
                    Typed rather than scrolled: a few hundred cities is well past what a menu of
                    them is any use for. */}
                <Autocomplete
                  id="location"
                  options={selectableLocations}
                  groupBy={(l: CityType) => l.region}
                  getOptionLabel={(l: CityType) => l.name}
                  isOptionEqualToValue={(a: CityType, b: CityType) =>
                    a.id === b.id
                  }
                  value={location}
                  onChange={(_e: unknown, picked: CityType | null) => {
                    if (picked) {
                      change({
                        locationId: picked.id,
                        location: picked,
                        startingCustomers: getStartingCustomers(picked),
                      });
                    }
                  }}
                  disableClearable
                  autoHighlight
                  openOnFocus
                  sx={{ minWidth: 200 }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      variant="standard"
                      placeholder="Search cities"
                    />
                  )}
                />
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Starting customers</TableCell>
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
                  valueLabelFormat={(value: number) => value.toLocaleString()}
                  onChange={(_event: Event, value: number | number[]) =>
                    change({
                      startingCustomers: Array.isArray(value)
                        ? value[0]
                        : value,
                    })
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
              <TableCell>Starting year</TableCell>
              <TableCell>
                <Select
                  id="startingYear"
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
                  value={scenario.ownership}
                  onChange={(e: SelectChangeEvent<ScenarioType["ownership"]>) =>
                    change({
                      ownership: e.target.value as ScenarioType["ownership"],
                    })
                  }
                >
                  <MenuItem value="Investor">Investor-Owned</MenuItem>
                  <MenuItem value="Public">Public-Owned</MenuItem>
                </Select>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Starting cash</TableCell>
              <TableCell>
                <Select
                  id="cash"
                  value={scenario.cash}
                  onChange={(e: SelectChangeEvent<number>) =>
                    change({ cash: Number(e.target.value) })
                  }
                >
                  {STARTING_CASH.map((c: number) => {
                    return (
                      <MenuItem value={c} key={c}>
                        ${c / 1000000}M
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
                  value={game.difficulty}
                  onChange={(e: SelectChangeEvent<DifficultyType>) =>
                    onDelta({ difficulty: e.target.value as DifficultyType })
                  }
                >
                  {Object.keys(DIFFICULTIES).map((d: string) => {
                    return (
                      <MenuItem value={d} key={d}>
                        <Tooltip
                          title={DIFFICULTIES[d].description}
                          placement="right"
                        >
                          <span>{d}</span>
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

        <Typography variant="h6" sx={{ paddingLeft: 1, paddingTop: 1 }}>
          Starting facilities
        </Typography>
        {unavailable.length > 0 && (
          <Typography variant="body2" color="error" sx={{ paddingLeft: 1 }}>
            {unavailable.map(facilityName).join(", ")} can't be built with this
            location and year, or exceeds the number of viable sites. Remove{" "}
            {unavailable.length === 1 ? "it" : "them"} or change the setup.
          </Typography>
        )}

        {scenario.facilities.map(
          (f: Partial<FacilityShoppingType>, i: number) => {
            return (
              <Card className="build-list-item" key={`${facilityName(f)}${i}`}>
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

        <div style={{ padding: "8px", textAlign: "center" }}>
          <Select
            id="addFacilityName"
            displayEmpty
            value={adding ? adding.name : ""}
            onChange={(e: SelectChangeEvent<string>) => {
              const next = technologies.find((t) => t.name === e.target.value);
              setAddName(e.target.value);
              // Sizes differ between generators and storage, so carrying the old one over would
              // offer a watt-hour capacity for a generator. Opens on a middling plant rather
              // than the biggest one the year allows, which is a lot to hand someone by default
              if (next) {
                const options = (
                  next.storage ? STORAGE_SIZES_WH : GENERATOR_SIZES_W
                ).filter((s) => s <= next.maxSize);
                setAddSize(
                  options[Math.min(next.storage ? 1 : 2, options.length - 1)],
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
          &nbsp;
          <Select
            id="addFacilitySize"
            value={sizes.indexOf(addSize) === -1 ? sizes[0] : addSize}
            disabled={!adding}
            onChange={(e: SelectChangeEvent<number>) =>
              setAddSize(Number(e.target.value))
            }
          >
            {sizes.map((size: number) => {
              return (
                <MenuItem value={size} key={size}>
                  {adding?.storage ? formatWattHours(size) : formatWatts(size)}
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

        <div style={{ textAlign: "center", padding: "12px" }}>
          <Button
            size="large"
            variant="contained"
            color="primary"
            disabled={unavailable.length > 0}
            onClick={() => onStart(scenario)}
            autoFocus
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
          A fee placed on pollution to cover its damage to society. Charged by
          the amount of greenhouse gas emitted, measured in{" "}
          {largeMassUnit(units)} of CO2 equivalent.
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
