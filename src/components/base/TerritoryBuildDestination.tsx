import * as React from "react";
import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";
import { TERRITORIES } from "../../data/Territories";
import { ownedTerritories } from "../../helpers/Territories";
import type { GameType, TerritoryId } from "../../Types";
import { useToolState } from "./GameToolMemory";

export const TERRITORY_BUILD_MEMORY_KEY = "build.territory";

export function territoryName(id: TerritoryId): string {
  return TERRITORIES.find((territory) => territory.id === id)?.name ?? id;
}

export function useTerritoryBuildDestination() {
  return useToolState<TerritoryId>(TERRITORY_BUILD_MEMORY_KEY, "champlain");
}

export default function TerritoryBuildDestination({
  game,
  value,
  onChange,
}: {
  game: GameType;
  value: TerritoryId;
  onChange: (id: TerritoryId) => void;
}) {
  const id = React.useId();
  const owned = ownedTerritories(game);
  return (
    <div className="territoryBuildDestination">
      <FormControl fullWidth size="small">
        <InputLabel id={`${id}-label`}>Build destination</InputLabel>
        <Select
          labelId={`${id}-label`}
          label="Build destination"
          value={value}
          onChange={(event) => onChange(event.target.value as TerritoryId)}
        >
          {TERRITORIES.map((territory) => (
            <MenuItem
              key={territory.id}
              value={territory.id}
              disabled={!owned.includes(territory.id)}
            >
              {territory.name}
              {!owned.includes(territory.id) ? " · not owned" : ""}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Typography variant="caption" color="textSecondary">
        Each project reserves a local site. Output serves local demand first;
        transfers share the territory connection.
      </Typography>
    </div>
  );
}
