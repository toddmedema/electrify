import * as React from "react";
import cloneDeep from "lodash.clonedeep";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useAppDispatch } from "../../Store";
import {
  openPolicyDecision,
  closePolicyDecision,
} from "../../reducers/GameActions";
import { GameType } from "../../Types";
import {
  DOWNPAYMENT_PERCENT,
  TICKS_PER_YEAR,
  TICK_MINUTES,
} from "../../Constants";
import {
  getMonthYearFromMinute,
  getTimeFromTimeline,
} from "../../helpers/DateTime";
import { formatMoneyConcise } from "../../helpers/Format";
import {
  investmentCatalog,
  InvestmentPurchase,
  InvestmentPreviewResult,
} from "../../helpers/InvestmentPreview";
import { createInvestmentPreviewWorker } from "../../helpers/InvestmentPreviewClient";

function dateLabel(minute: number, game: GameType) {
  const date = getMonthYearFromMinute(minute, game.startingYear);
  return new Date(Date.UTC(date.year, date.monthNumber - 1)).toLocaleDateString(
    "en",
    { month: "short", year: "numeric", timeZone: "UTC" },
  );
}

function Planner({ game, onClose }: { game: GameType; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const token = React.useId();
  React.useEffect(() => {
    dispatch(openPolicyDecision(token));
    return () => {
      dispatch(closePolicyDecision(token));
    };
  }, [dispatch, token]);
  React.useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [onClose]);
  const mobile = useMediaQuery("(max-width:599px)");
  const [kind, setKind] =
    React.useState<InvestmentPurchase["kind"]>("generator");
  const [capacity, setCapacity] = React.useState("10");
  const [name, setName] = React.useState("");
  const [financed, setFinanced] = React.useState(false);
  const [purchases, setPurchases] = React.useState<InvestmentPurchase[]>([]);
  const [years, setYears] = React.useState(3);
  const [result, setResult] = React.useState<InvestmentPreviewResult>();
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const worker = React.useRef<Worker>();
  const cancel = React.useCallback(() => {
    worker.current?.terminate();
    worker.current = undefined;
    setBusy(false);
    setResult(undefined);
    setError("");
  }, []);
  React.useEffect(() => () => worker.current?.terminate(), []);
  const catalog = investmentCatalog(game, kind, Number(capacity));
  const selected = catalog.find((f) => f.name === name);
  const upfront = purchases.reduce((total, purchase) => {
    const quote = investmentCatalog(
      game,
      purchase.kind,
      purchase.capacity,
    ).find((f) => f.name === purchase.name)!;
    return (
      total + quote.buildCost * (purchase.financed ? DOWNPAYMENT_PERCENT : 1)
    );
  }, 0);
  const availableCash =
    getTimeFromTimeline(game.date.minute, game.timeline)?.cash ?? 0;
  const valid =
    selected?.available &&
    selected.viableLocationsRemaining !== 0 &&
    ("maxPeakWh" in selected
      ? selected.peakWh! <= selected.maxPeakWh
      : selected.peakW <= selected.maxPeakW);
  const run = () => {
    cancel();
    setBusy(true);
    try {
      const active = createInvestmentPreviewWorker();
      worker.current = active;
      active.onmessage = (event) => {
        if (worker.current !== active) return;
        setResult(event.data.result);
        setError(event.data.error || "");
        setBusy(false);
        active.terminate();
        worker.current = undefined;
      };
      active.onerror = () => {
        if (worker.current === active) {
          cancel();
          setError("The projection could not finish. Please try again.");
        }
      };
      active.postMessage({ game, purchases, years });
    } catch (_error) {
      cancel();
      setError("The projection could not start. Please try again.");
    }
  };
  const first = (minute: number | null) =>
    minute === null ? "None in this horizon" : dateLabel(minute, game);
  const metrics = result
    ? [
        [
          "First shortage",
          first(result.before.firstShortage),
          first(result.after.firstShortage),
        ],
        [
          "Unserved energy",
          `${(result.before.shortageWh / 1e9).toFixed(2)} GWh`,
          `${(result.after.shortageWh / 1e9).toFixed(2)} GWh`,
        ],
        [
          "Ending cash",
          formatMoneyConcise(result.before.cash),
          formatMoneyConcise(result.after.cash),
        ],
        [
          "Lowest cash",
          formatMoneyConcise(result.before.minimumCash),
          formatMoneyConcise(result.after.minimumCash),
        ],
        [
          "Ending net worth (includes debt)",
          formatMoneyConcise(result.before.netWorth),
          formatMoneyConcise(result.after.netWorth),
        ],
        [
          "Emissions",
          `${(result.before.kgco2e / 1000).toFixed(0)} t CO₂e`,
          `${(result.after.kgco2e / 1000).toFixed(0)} t CO₂e`,
        ],
      ]
    : [];
  return (
    <Dialog
      open
      onClose={onClose}
      fullScreen={mobile}
      fullWidth
      maxWidth="md"
      aria-labelledby="investment-title"
      sx={{
        "& button": { minHeight: 44 },
        "& .MuiInputBase-root": { minHeight: 44 },
      }}
    >
      <DialogTitle id="investment-title">Test an investment plan</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2">
            Game paused. Planning from {dateLabel(game.date.minute, game)}. Add
            generators and storage, then compare with making no new purchases.
            Nothing here spends your live cash.
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: 2,
            }}
          >
            <TextField
              select
              label="Asset type"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as InvestmentPurchase["kind"]);
                setName("");
              }}
            >
              <MenuItem value="generator">Generator</MenuItem>
              <MenuItem value="storage">Storage</MenuItem>
            </TextField>
            <TextField
              label={
                kind === "generator" ? "Capacity (MW)" : "Energy capacity (MWh)"
              }
              type="number"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              slotProps={{ htmlInput: { min: 1, max: 10000, step: 1 } }}
              helperText="1–10,000; availability depends on asset and year"
            />
            <TextField
              select
              label="Facility"
              value={selected ? name : ""}
              onChange={(e) => setName(e.target.value)}
            >
              {catalog.map((f) => (
                <MenuItem key={f.name} value={f.name}>
                  {f.name}
                  {!f.available ? " (not available yet)" : ""}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Payment"
              value={financed ? "loan" : "cash"}
              onChange={(e) => setFinanced(e.target.value === "loan")}
            >
              <MenuItem value="cash">Pay cash</MenuItem>
              <MenuItem value="loan">
                Loan ({DOWNPAYMENT_PERCENT * 100}% down)
              </MenuItem>
            </TextField>
          </Box>
          {selected && (
            <Typography variant="body2">
              {formatMoneyConcise(selected.buildCost)} total ·{" "}
              {formatMoneyConcise(
                selected.buildCost * (financed ? DOWNPAYMENT_PERCENT : 1),
              )}{" "}
              due now · online in {Math.round(selected.yearsToBuild * 12)}{" "}
              months.{!valid && " Unavailable at this capacity or location."}
            </Typography>
          )}
          <Button
            variant="outlined"
            disabled={!valid || purchases.length >= 8}
            onClick={() => {
              cancel();
              setPurchases([
                ...purchases,
                { kind, name, capacity: Number(capacity), financed },
              ]);
            }}
          >
            Add to plan ({purchases.length}/8)
          </Button>
          {purchases.length > 0 && (
            <Stack
              component="section"
              aria-label="Proposed purchases"
              spacing={1}
            >
              <Typography variant="h6">Proposed purchases</Typography>
              {purchases.map((p, i) => {
                const quote = investmentCatalog(game, p.kind, p.capacity).find(
                  (f) => f.name === p.name,
                )!;
                return (
                  <Box
                    key={i}
                    sx={{ borderBottom: 1, borderColor: "divider", pb: 1 }}
                  >
                    <Typography>
                      {i + 1}. {p.name} · {p.capacity}{" "}
                      {p.kind === "storage" ? "MWh" : "MW"}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {p.financed ? "Loan" : "Cash"} ·{" "}
                      {formatMoneyConcise(
                        quote.buildCost *
                          (p.financed ? DOWNPAYMENT_PERCENT : 1),
                      )}{" "}
                      now · online{" "}
                      {dateLabel(
                        game.date.minute +
                          quote.yearsToBuild * TICKS_PER_YEAR * TICK_MINUTES,
                        game,
                      )}
                    </Typography>
                    <Button
                      onClick={() => {
                        cancel();
                        setPurchases(
                          purchases.filter((_, index) => index !== i),
                        );
                      }}
                      aria-label={`Remove purchase ${i + 1}: ${p.name}`}
                    >
                      Remove
                    </Button>
                  </Box>
                );
              })}
            </Stack>
          )}
          <TextField
            select
            label="Projection horizon"
            value={years}
            onChange={(e) => {
              cancel();
              setYears(Number(e.target.value));
            }}
          >
            {[1, 3, 5].map((n) => (
              <MenuItem key={n} value={n}>
                {n} game year{n > 1 ? "s" : ""}
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="body2">
            Plan due now: {formatMoneyConcise(upfront)} · Available cash:{" "}
            {formatMoneyConcise(availableCash)}.
          </Typography>
          {upfront > availableCash && (
            <Alert severity="warning">
              The upfront cost exceeds your cash. Remove a purchase and add it
              again with a loan, or reduce its capacity.
            </Alert>
          )}
          <Button
            variant="contained"
            disabled={purchases.length === 0 || busy}
            onClick={run}
          >
            {busy ? "Simulating…" : "Compare plan"}
          </Button>
          {busy && (
            <Typography role="status">
              Simulating both paths. You can keep editing or close this sandbox.
            </Typography>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {result && (
            <Stack
              component="section"
              aria-label="Investment comparison"
              spacing={1}
            >
              <Typography variant="h6">
                Comparison through{" "}
                {dateLabel(
                  game.date.minute + years * TICKS_PER_YEAR * TICK_MINUTES,
                  game,
                )}
              </Typography>
              <Typography variant="body2">
                Cash difference:{" "}
                {formatMoneyConcise(result.after.cash - result.before.cash)}.
                Net worth difference:{" "}
                {formatMoneyConcise(
                  result.after.netWorth - result.before.netWorth,
                )}
                .
              </Typography>
              {result.after.minimumCash < 0 && (
                <Alert severity="warning">
                  This plan runs out of cash within the horizon.
                </Alert>
              )}
              {metrics.map(([label, before, after]) => (
                <Box
                  key={label}
                  sx={{ borderBottom: 1, borderColor: "divider", py: 1 }}
                >
                  <Typography sx={{ fontWeight: 600 }}>{label}</Typography>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                      gap: 1,
                    }}
                  >
                    <Typography variant="body2">
                      No purchases: {before}
                    </Typography>
                    <Typography variant="body2">Your plan: {after}</Typography>
                  </Box>
                </Box>
              ))}
            </Stack>
          )}
          <Typography variant="body2" color="text.secondary">
            Uses the game’s simulation for construction delays, dispatch,
            storage charging, operating costs, loan payments, emissions and
            scheduled effects. Both paths use the same weather and seed, with
            the current retail electricity rate, programs and dispatch choices
            held as decisions. Future market prices and demand still evolve. All
            proposed purchases begin at the snapshot date, in the listed order.
            Projections continue through cash shortages and do not predict
            firing or victory. To build, close this sandbox and review each
            purchase in the catalog.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close sandbox</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function InvestmentPlanner({ game }: { game: GameType }) {
  const [snapshot, setSnapshot] = React.useState<GameType>();
  return (
    <>
      <Button
        sx={{ minHeight: 44, m: 1 }}
        onClick={() => setSnapshot(cloneDeep(game))}
      >
        Test an investment plan
      </Button>
      {snapshot && (
        <Planner game={snapshot} onClose={() => setSnapshot(undefined)} />
      )}
    </>
  );
}
