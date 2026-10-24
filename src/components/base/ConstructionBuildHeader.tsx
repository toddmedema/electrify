import * as React from "react";
import {
  FormControl,
  IconButton,
  Menu,
  MenuItem,
  Select,
  Slider,
  Typography,
  useMediaQuery,
} from "@mui/material";
import SortIcon from "@mui/icons-material/Sort";

interface Props {
  capacity: string;
  capacityLabel?: string;
  sliderDisabled?: boolean;
  sliderValueText?: (value: number) => string;
  sortLabel?: string;
  sliderValue: number;
  sliderMin: number;
  sliderMax: number;
  sort: string;
  sortOptions: ReadonlyArray<readonly [string, string]>;
  onSliderChange: (value: number) => void;
  onSortChange: (value: string) => void;
}

/**
 * The size and sort controls shared by the construction catalogs. The title, cash and
 * close button belong to the Build screen's CatalogTitleBar above them.
 */
export default function ConstructionBuildHeader(
  props: Props,
): React.JSX.Element {
  const [sortAnchorEl, setSortAnchorEl] = React.useState<HTMLElement | null>(
    null,
  );
  // Keep the compact icon-only sort control on phones to preserve usable slider width.
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
      <div className="constructionControls">
        <Typography
          id="construction-capacity"
          className="constructionCapacity"
          variant="body2"
        >
          <span className="srOnly">{props.capacityLabel || "Capacity"} </span>
          <Typography component="strong">{props.capacity}</Typography>
        </Typography>
        <Slider
          className="constructionCapacitySlider"
          value={props.sliderValue}
          disabled={props.sliderDisabled}
          getAriaValueText={props.sliderValueText}
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
              renderValue={() => currentSortLabel}
              IconComponent={SortIcon}
              inputProps={{
                "aria-label": props.sortLabel || "Sort facilities",
              }}
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
              aria-label={`${props.sortLabel || "Sort facilities"}: ${currentSortLabel}`}
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
                    <span>{label}</span>
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
