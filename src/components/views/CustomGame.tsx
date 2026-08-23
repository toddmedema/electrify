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
import { DIFFICULTIES, LOCATIONS } from "../../Constants";
import { GENERATORS, STORAGE } from "../../data/Facilities";
import { getDateFromMinute } from "../../helpers/DateTime";
import { formatWattHours, formatWatts } from "../../helpers/Format";
import { newSeed } from "../../helpers/Math";
import {
  DifficultyType,
  FacilityShoppingType,
  GameType,
  LocationIdType,
  LocationType,
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

// Weather data runs 1980 - 2019 and is projected forwards from there, so anything from 1980 on
// plays; earlier would have nothing to project from
const STARTING_YEARS = [1980, 1990, 2000, 2010, 2020];
const DURATION_YEARS = [1, 5, 10, 20, 40];
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
  // Starting facilities are built free and already finished, so the only limit is what the
  // technology could actually be built at in that year
  const totalPeakW = scenario.facilities.reduce(
    (sum: number, f: Partial<FacilityShoppingType>) => sum + (f.peakW || 0),
    0,
  );

  // Rolling the year back past a technology's invention would otherwise leave a facility in the
  // list that quietly disappears once the game loads
  const unavailable = scenario.facilities.filter(
    (f: Partial<FacilityShoppingType>) =>
      !technologies.some((t) => t.name === facilityName(f)),
  );

  const change = (delta: Partial<ScenarioType>) => {
    setScenario({ ...scenario, ...delta });
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
                <Select
                  id="location"
                  value={scenario.locationId}
                  onChange={(e: SelectChangeEvent<LocationIdType>) =>
                    change({ locationId: e.target.value as LocationIdType })
                  }
                >
                  {Object.values(LOCATIONS).map((l: LocationType) => {
                    return (
                      <MenuItem value={l.id} key={l.id}>
                        {l.name}
                      </MenuItem>
                    );
                  })}
                </Select>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Starting year</TableCell>
              <TableCell>
                <Select
                  id="startingYear"
                  value={scenario.startingYear}
                  onChange={(e: SelectChangeEvent<number>) =>
                    change({ startingYear: Number(e.target.value) })
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
                  {RATES_PER_KWH.map((r: number) => {
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
                  {FEES_PER_TON.map((f: number) => {
                    return (
                      <MenuItem value={f / 1000} key={f}>
                        ${f}/ton
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
        <Typography
          variant="body2"
          color="textSecondary"
          sx={{ paddingLeft: 1 }}
        >
          {scenario.facilities.length === 0
            ? "None - you'll be blacking out until you build something"
            : `${formatWatts(totalPeakW)} of generation, free and already running`}
        </Typography>
        {unavailable.length > 0 && (
          <Typography variant="body2" color="error" sx={{ paddingLeft: 1 }}>
            {unavailable.map(facilityName).join(", ")} can't be built in{" "}
            {scenario.startingYear} - remove{" "}
            {unavailable.length === 1 ? "it" : "them"} or pick a later year.
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
          the amount of greenhouse gas emitted, generally measured in "tons of
          CO2 equivalent".
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
