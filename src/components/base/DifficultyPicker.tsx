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
import { DIFFICULTY_IDS, DIFFICULTY_LABELS } from "../../Constants";
import { DifficultyType } from "../../Types";

// Interface copy stays out of Constants.tsx so editing it never changes the run compatibility ID
export const DIFFICULTY_DESCRIPTIONS: Record<DifficultyType, string> = {
  Intern:
    "Most forgiving: much lower costs, very fast building, smaller outage penalties.",
  Employee:
    "Forgiving: lower costs, faster building, smaller outage penalties.",
  Manager:
    "Balanced: some help with costs, building time, outage penalties.",
  VP: "Demanding: a little help with costs and building time.",
  CEO: "Full challenge: unadjusted costs, building times, outage penalties.",
};

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
            <Tooltip title={DIFFICULTY_DESCRIPTIONS[d]} placement="right">
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
            title={DIFFICULTY_DESCRIPTIONS[d]}
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
              {DIFFICULTY_DESCRIPTIONS[difficulty]}
            </span>
          ))}
        </Typography>
      )}
    </>
  );
}
