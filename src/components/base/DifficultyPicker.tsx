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
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { difficultyLockReason } from "../../achievements/DifficultyUnlocks";
import { DIFFICULTY_IDS, DIFFICULTY_LABELS } from "../../Constants";
import { DifficultyType, ScenarioType } from "../../Types";
import { reliabilityRuleText } from "../../helpers/ObjectiveRules";

// Interface copy stays out of Constants.tsx so editing it never changes the run compatibility ID
export const DIFFICULTY_DESCRIPTIONS: Record<DifficultyType, string> = {
  Intern:
    "Most forgiving: much lower costs, very fast building, smaller outage penalties.",
  Employee:
    "Forgiving: lower costs, faster building, smaller outage penalties.",
  Manager: "Balanced: some help with costs, building time, outage penalties.",
  VP: "Demanding: a little help with costs and building time.",
  CEO: "Full challenge: unadjusted costs, building times, outage penalties.",
};

export interface DifficultyPickerProps {
  value: DifficultyType;
  scenario?: Pick<
    ScenarioType,
    "reliabilityFailureDisabled" | "retainCustomersDuringShortages"
  >;
  onChange: (difficulty: DifficultyType) => void;
  // A row of buttons for a screen built around the choice, or a compact select for a settings table
  variant: "toggle" | "select";
  // The chosen difficulty's reliability rule; toggle controls also describe the economic effects.
  showDescription?: boolean;
  id?: string;
  /** Shows the choice someone else is making, such as a co-op host's difficulty. */
  readOnly?: boolean;
  /** Omit for authoring controls, which inspect rules rather than start a run. */
  unlockedThrough?: DifficultyType;
}

function isDifficulty(value: unknown): value is DifficultyType {
  return DIFFICULTY_IDS.includes(value as DifficultyType);
}

/** The one control for choosing a run's difficulty. */
export default function DifficultyPicker({
  value,
  scenario,
  onChange,
  variant,
  showDescription,
  id,
  readOnly,
  unlockedThrough,
}: DifficultyPickerProps): React.JSX.Element {
  const descriptionId = React.useId();
  const [inspected, setInspected] = React.useState<DifficultyType>();
  const lockReason = (difficulty: DifficultyType) =>
    unlockedThrough && !readOnly
      ? difficultyLockReason(difficulty, unlockedThrough)
      : undefined;
  const nextLocked = DIFFICULTY_IDS.find((difficulty) =>
    lockReason(difficulty),
  );
  const reason =
    (inspected && lockReason(inspected)) ||
    (nextLocked && lockReason(nextLocked));
  const lockHint = reason ? (
    <Typography
      id={descriptionId}
      className="difficultyLockHint"
      variant="body2"
      color="text.secondary"
      role="status"
      sx={{
        display: "flex",
        alignItems: "flex-start",
        gap: 1,
        mt: 1,
        textAlign: "left",
      }}
    >
      <LockOutlinedIcon
        aria-hidden="true"
        sx={{ fontSize: 16, mt: "2px", flexShrink: 0 }}
      />
      <span>{reason}</span>
    </Typography>
  ) : null;
  if (variant === "select") {
    return (
      <>
        <Select
          id={id}
          disabled={readOnly}
          inputProps={{ "aria-label": "Difficulty" }}
          value={value}
          onChange={(e: SelectChangeEvent<DifficultyType>) => {
            if (isDifficulty(e.target.value) && !lockReason(e.target.value)) {
              onChange(e.target.value);
            }
          }}
        >
          {DIFFICULTY_IDS.map((d) => (
            <MenuItem
              value={d}
              key={d}
              aria-disabled={!!readOnly || !!lockReason(d)}
              aria-describedby={
                lockReason(d) ? `${descriptionId}-${d}` : undefined
              }
              aria-label={
                lockReason(d)
                  ? `${DIFFICULTY_LABELS[d]}, locked`
                  : DIFFICULTY_LABELS[d]
              }
              onClick={() => {
                if (lockReason(d)) setInspected(d);
              }}
              sx={lockReason(d) ? { color: "text.secondary" } : undefined}
            >
              {lockReason(d) ? (
                <span style={{ display: "flex", flexDirection: "column" }}>
                  <span>
                    <LockOutlinedIcon sx={{ fontSize: 14, mr: 0.5 }} />
                    {DIFFICULTY_LABELS[d]} · Locked
                  </span>
                  <Typography
                    id={`${descriptionId}-${d}`}
                    variant="caption"
                    sx={{ whiteSpace: "normal" }}
                  >
                    {lockReason(d)}
                  </Typography>
                </span>
              ) : (
                <Tooltip
                  title={`${DIFFICULTY_DESCRIPTIONS[d]} ${reliabilityRuleText(d, scenario)}`}
                  placement="right"
                >
                  <span>{DIFFICULTY_LABELS[d]}</span>
                </Tooltip>
              )}
            </MenuItem>
          ))}
        </Select>
        {lockHint}
        {showDescription && (
          <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
            {reliabilityRuleText(value, scenario)}
          </Typography>
        )}
      </>
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
          if (isDifficulty(difficulty) && !lockReason(difficulty)) {
            setInspected(undefined);
            onChange(difficulty);
          }
        }}
      >
        {DIFFICULTY_IDS.map((d) => (
          <ToggleButton
            value={d}
            key={d}
            disabled={readOnly}
            className={lockReason(d) ? "difficultyLocked" : undefined}
            title={
              lockReason(d) ||
              `${DIFFICULTY_DESCRIPTIONS[d]} ${reliabilityRuleText(d, scenario)}`
            }
            aria-label={
              lockReason(d)
                ? `${DIFFICULTY_LABELS[d]}, locked`
                : DIFFICULTY_LABELS[d]
            }
            aria-disabled={!!readOnly || !!lockReason(d)}
            aria-describedby={lockReason(d) ? descriptionId : undefined}
            onClick={() => {
              if (lockReason(d)) setInspected(d);
            }}
            onFocus={() => {
              if (lockReason(d)) setInspected(d);
            }}
          >
            {lockReason(d) && (
              <LockOutlinedIcon aria-hidden="true" sx={{ fontSize: 14 }} />
            )}
            {DIFFICULTY_LABELS[d]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {lockHint}
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
              {DIFFICULTY_DESCRIPTIONS[difficulty]}{" "}
              {reliabilityRuleText(difficulty, scenario)}
            </span>
          ))}
        </Typography>
      )}
    </>
  );
}
