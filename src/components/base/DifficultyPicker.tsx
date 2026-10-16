import * as React from "react";
import {
  MenuItem,
  Select,
  SelectChangeEvent,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  DIFFICULTY_LABELS,
} from "../../Constants";
import { DifficultyType } from "../../Types";

export interface DifficultyPickerProps {
  value: DifficultyType;
  onChange: (difficulty: DifficultyType) => void;
  // A row of buttons for a screen built around the choice, or a compact select for a settings table
  variant: "toggle" | "select";
  // Toggle only: the chosen difficulty's description beneath the buttons
  showDescription?: boolean;
  id?: string;
  /** Shows the choice someone else is making, such as a co-op host's difficulty. */
  readOnly?: boolean;
}

function isDifficulty(value: unknown): value is DifficultyType {
  return DIFFICULTY_IDS.includes(value as DifficultyType);
}

/** The one control for choosing a run's difficulty. */
export default function DifficultyPicker({
  value,
  onChange,
  variant,
  showDescription,
  id,
  readOnly,
}: DifficultyPickerProps): React.JSX.Element {
  if (variant === "select") {
    return (
      <Select
        id={id}
        disabled={readOnly}
        inputProps={{ "aria-label": "Difficulty" }}
        value={value}
        onChange={(e: SelectChangeEvent<DifficultyType>) => {
          if (isDifficulty(e.target.value)) {
            onChange(e.target.value);
          }
        }}
      >
        {DIFFICULTY_IDS.map((d) => (
          <MenuItem value={d} key={d}>
            <Tooltip title={DIFFICULTIES[d].description} placement="right">
              <span>{DIFFICULTY_LABELS[d]}</span>
            </Tooltip>
          </MenuItem>
        ))}
      </Select>
    );
  }
  return (
    <>
      <ToggleButtonGroup
        id={id}
        exclusive
        value={value}
        size="small"
        color="primary"
        aria-label="Difficulty"
        onChange={(_event, difficulty: unknown) => {
          if (isDifficulty(difficulty)) {
            onChange(difficulty);
          }
        }}
      >
        {DIFFICULTY_IDS.map((d) => (
          <ToggleButton
            value={d}
            key={d}
            disabled={readOnly}
            title={DIFFICULTIES[d].description}
            aria-label={DIFFICULTY_LABELS[d]}
          >
            {DIFFICULTY_LABELS[d]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {showDescription && (
        <Typography
          className="difficultyDescription"
          variant="body2"
          color="textSecondary"
          sx={{ display: "grid" }}
        >
          {/* Share one grid cell so changing the copy never changes the control's height. */}
          {DIFFICULTY_IDS.map((difficulty) => (
            <span
              key={difficulty}
              aria-hidden={difficulty !== value}
              style={{
                gridArea: "1 / 1",
                visibility: difficulty === value ? "visible" : "hidden",
              }}
            >
              {DIFFICULTIES[difficulty].description}
            </span>
          ))}
        </Typography>
      )}
    </>
  );
}
