import * as React from "react";
import {
  FormControl,
  IconButton,
  Menu,
  MenuItem,
  Select,
  Slider,
  Toolbar,
  Typography,
  useMediaQuery,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import SortIcon from "@mui/icons-material/Sort";
import { ConceptNameType } from "../../Types";
import { formatMoneyStable } from "../../helpers/Format";
import ConceptIcon from "./ConceptIcon";

interface Props {
  concept: ConceptNameType;
  title: string;
  cash: number;
  capacity: string;
  sliderValue: number;
  sliderMin: number;
  sliderMax: number;
  sort: string;
  sortOptions: ReadonlyArray<readonly [string, string]>;
  onClose: () => void;
  onSliderChange: (value: number) => void;
  onSortChange: (value: string) => void;
}

/**
 * Shared chrome for the generator and storage catalogs.
 *
 * The first row follows the same hierarchy as GameAppBar: current context on the left and the
 * one global action on the right. The decision controls get their own shorter row so the title,
 * cash, capacity and sort order do not compete for one wrapped toolbar.
 */
export default function ConstructionBuildHeader(
  props: Props,
): React.JSX.Element {
  const [sortAnchorEl, setSortAnchorEl] = React.useState<HTMLElement | null>(
    null,
  );
  // At 600px the label, useful slider track and 150px select all fit without truncation. Below
  // that, preserving the slider's usable width is worth the compact icon-only sort control.
  const showSortSelect = useMediaQuery("(min-width:600px)");
  const currentSortLabel =
    props.sortOptions.find(([value]) => value === props.sort)?.[1] ||
    props.sort;

  const updateSort = (value: string) => {
    props.onSortChange(value);
    setSortAnchorEl(null);
  };

  return (
    <header className="constructionHeader">
      <Toolbar className="constructionTitleBar">
        <Typography variant="h6" className="constructionTitle">
          <span className="iconLabel">
            <ConceptIcon concept={props.concept} fontSize="small" />
            {props.title}
          </span>
          <span
            className="weak constructionCash"
            aria-label={`Available cash ${formatMoneyStable(props.cash)}`}
          >
            {formatMoneyStable(props.cash)} cash
          </span>
        </Typography>
        <IconButton
          id="close-button"
          color="primary"
          onClick={props.onClose}
          aria-label="close"
          size="large"
        >
          <CloseIcon />
        </IconButton>
      </Toolbar>
      <div className="constructionControls">
        <Typography
          id="construction-capacity"
          className="constructionCapacity"
          variant="body2"
        >
          <span className="weak">Capacity</span>
          <Typography color="primary" component="strong">
            {props.capacity}
          </Typography>
        </Typography>
        <Slider
          className="constructionCapacitySlider"
          value={props.sliderValue}
          aria-labelledby="construction-capacity"
          valueLabelDisplay="off"
          min={props.sliderMin}
          step={1}
          max={props.sliderMax}
          onChange={(_event: Event, newValue: number | number[]) =>
            props.onSliderChange(
              Array.isArray(newValue) ? newValue[0] : newValue,
            )
          }
        />
        {showSortSelect ? (
          <FormControl className="constructionSortSelect" size="small">
            <Select
              value={props.sort}
              onChange={(event) => updateSort(event.target.value)}
              renderValue={() => `Sort: ${currentSortLabel}`}
              inputProps={{ "aria-label": "Sort facilities" }}
            >
              {props.sortOptions.map(([value, label]) => (
                <MenuItem value={value} key={value}>
                  {label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        ) : (
          <>
            <IconButton
              className="constructionSortButton"
              color="primary"
              onClick={(event) => setSortAnchorEl(event.currentTarget)}
              aria-label={`Sort facilities: ${currentSortLabel}`}
              size="large"
            >
              <SortIcon />
            </IconButton>
            <Menu
              id="sort-menu"
              anchorEl={sortAnchorEl}
              keepMounted
              open={Boolean(sortAnchorEl)}
              onClose={() => setSortAnchorEl(null)}
            >
              {props.sortOptions.map(([value, label]) => (
                <MenuItem onClick={() => updateSort(value)} key={value}>
                  {props.sort === value ? (
                    <strong>{label}</strong>
                  ) : (
                    <span className="weak">{label}</span>
                  )}
                </MenuItem>
              ))}
            </Menu>
          </>
        )}
      </div>
    </header>
  );
}
