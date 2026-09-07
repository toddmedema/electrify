import * as React from "react";
import {
  Button,
  Chip,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";
import { DOWNPAYMENT_PERCENT } from "../../Constants";
import {
  adjacentMarketForCorridor,
  corridorsForLocation,
} from "../../data/AdjacentMarkets";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import { formatMoneyConcise, formatWatts } from "../../helpers/Format";
import { transmissionRatingW } from "../../helpers/Transmission";
import { GameType, TradingPolicyType } from "../../Types";

const POLICY_LABELS: Record<TradingPolicyType, string> = {
  BALANCED: "Buy for shortages, sell extra",
  RELIABILITY_FIRST: "Buy for shortages only",
  SURPLUS_ONLY: "Sell extra only",
  CLOSED: "No trading",
};

export interface TransmissionPanelProps {
  game: GameType;
  onBuild: (corridorId: string, financed: boolean) => void;
  onPolicy: (policy: TradingPolicyType) => void;
}

export default function TransmissionPanel({
  game,
  onBuild,
  onPolicy,
}: TransmissionPanelProps) {
  const state = game.transmission ?? { tradingPolicy: "BALANCED", lines: [] };
  const corridors = corridorsForLocation(game.location);
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  const readOnly = !!game.replayPlayback;

  if (!corridors.length) {
    return (
      <div className="transmissionEmpty">
        <img src="/images/transmission-option-2.svg" alt="Power exchange" />
        <Typography variant="h6">
          Interties are coming to this region
        </Typography>
        <Typography color="textSecondary">
          The first market connection is calibrated for California. Your grid
          keeps running normally without one.
        </Typography>
      </div>
    );
  }

  return (
    <div className="transmissionPanel scrollable">
      <section className="transmissionIntro">
        <img
          src="/images/transmission-option-2.svg"
          alt="Two grids exchanging power"
        />
        <div>
          <Typography variant="h6">Share power with nearby grids</Typography>
          <Typography variant="body2" color="textSecondary">
            An intertie is a large power line between regions. It can import
            energy during a shortage or sell energy you can safely spare.
          </Typography>
        </div>
      </section>

      <FormControl fullWidth size="small" className="tradingPolicy">
        <InputLabel id="trading-policy-label">Trading rule</InputLabel>
        <Select
          labelId="trading-policy-label"
          label="Trading rule"
          value={state.tradingPolicy}
          disabled={readOnly}
          onChange={(event) =>
            onPolicy(event.target.value as TradingPolicyType)
          }
        >
          {Object.entries(POLICY_LABELS).map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {!!state.lines.length && (
        <section aria-labelledby="your-interties-title">
          <Typography id="your-interties-title" variant="subtitle2">
            Your interties
          </Typography>
          <List dense disablePadding>
            {state.lines.map((line) => {
              const market = adjacentMarketForCorridor(line.corridorId);
              const rating = now
                ? transmissionRatingW(line, now)
                : line.capacityW;
              const building = line.yearsToBuildLeft > 0;
              return (
                <ListItem key={line.id} className="transmissionLine">
                  <ListItemAvatar>
                    <img
                      className="transmissionListIcon"
                      src="/images/transmission-option-2.svg"
                      alt=""
                    />
                  </ListItemAvatar>
                  <ListItemText
                    primary={line.name}
                    secondary={
                      building
                        ? `${line.yearsToBuildLeft.toFixed(1)} years until power can flow`
                        : `${formatWatts(rating)} available now · ${market?.name}`
                    }
                  />
                  <Chip
                    size="small"
                    color={building ? "default" : "success"}
                    label={building ? "Building" : "Trading"}
                  />
                </ListItem>
              );
            })}
          </List>
        </section>
      )}

      <section aria-labelledby="intertie-projects-title">
        <Typography id="intertie-projects-title" variant="subtitle2">
          Connection projects
        </Typography>
        <div className="transmissionProjects">
          {corridors.map((corridor) => {
            const market = adjacentMarketForCorridor(corridor.id);
            const built = state.lines.some(
              ({ corridorId }) => corridorId === corridor.id,
            );
            const downpayment = corridor.buildCost * DOWNPAYMENT_PERCENT;
            return (
              <article className="transmissionProject" key={corridor.id}>
                <div className="transmissionProjectHeading">
                  <div>
                    <Typography variant="subtitle1">{market?.name}</Typography>
                    <Typography variant="caption" color="textSecondary">
                      {corridor.name}
                    </Typography>
                  </div>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={
                      corridor.routeType === "EXISTING"
                        ? "Existing route"
                        : "New route"
                    }
                  />
                </div>
                <Typography variant="body2">{market?.description}</Typography>
                <dl className="transmissionMetrics">
                  <div>
                    <dt>Capacity</dt>
                    <dd>{formatWatts(corridor.capacityW)}</dd>
                  </div>
                  <div>
                    <dt>Build time</dt>
                    <dd>
                      {corridor.yearsToBuild} year
                      {corridor.yearsToBuild === 1 ? "" : "s"}
                    </dd>
                  </div>
                  <div>
                    <dt>Cost</dt>
                    <dd>{formatMoneyConcise(corridor.buildCost)}</dd>
                  </div>
                </dl>
                {!readOnly && (
                  <Button
                    fullWidth
                    variant="contained"
                    disabled={built || !now || now.cash < downpayment}
                    onClick={() => onBuild(corridor.id, true)}
                  >
                    {built
                      ? "Project started"
                      : `Build · ${formatMoneyConcise(downpayment)} down`}
                  </Button>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
