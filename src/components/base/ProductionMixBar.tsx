import * as React from "react";
import { ClickAwayListener, Tooltip } from "@mui/material";
import { formatWatts } from "../../helpers/Format";
import {
  chartPalette,
  fuelColors,
  getThemeVersion,
  subscribeThemeMode,
} from "../../Theme";
import { FuelNameType, TickPresentFutureType } from "../../Types";

type ProductionTick = Pick<
  TickPresentFutureType,
  "supplyByFuel" | "storageDischargeW" | "importedW"
>;

/** One live reading, in dispatch order. Charging and exports are loads, not sources. */
export default function ProductionMixBar({
  tick,
  fuelOrder,
}: {
  tick: ProductionTick | null;
  fuelOrder: FuelNameType[];
}) {
  React.useSyncExternalStore(subscribeThemeMode, getThemeVersion);
  const [open, setOpen] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);
  const tooltipRef = React.useRef<HTMLDivElement>(null);
  const fuels = [
    ...new Set([
      ...fuelOrder,
      ...(Object.keys(tick?.supplyByFuel || {}) as FuelNameType[]),
    ]),
  ];
  const sources = fuels.map((fuel) => ({
    name: fuel === "Sun" ? "Solar" : fuel === "Uranium" ? "Nuclear" : fuel,
    watts: tick?.supplyByFuel[fuel] || 0,
    color: fuelColors()[fuel],
  }));
  if (tick?.storageDischargeW) {
    sources.push({
      name: "Storage discharge",
      watts: tick.storageDischargeW,
      color: chartPalette().storage,
    });
  }
  if (tick?.importedW) {
    sources.push({
      name: "Imports",
      watts: tick.importedW,
      color: chartPalette().intertie,
    });
  }
  const total = sources.reduce((sum, source) => sum + source.watts, 0);
  const close = () => {
    setPinned(false);
    setOpen(false);
  };
  return (
    <ClickAwayListener onClickAway={close}>
      <div className="productionMix">
        <Tooltip
          title={
            <div className="productionMixDetails">
              <strong>Supply now</strong>
              {tick ? (
                <>
                  {total === 0 && <div>No production now</div>}
                  <div className="productionMixSources">
                    {sources.map((source) => (
                      <div className="productionMixSource" key={source.name}>
                        <span
                          className="productionMixSwatch"
                          data-testid="production-mix-swatch"
                          style={{ backgroundColor: source.color }}
                          aria-hidden="true"
                        />
                        <span>{source.name}</span>
                        <span>{formatWatts(source.watts)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="productionMixTotal">
                    <span>Total supply</span>
                    <strong>{formatWatts(total)}</strong>
                  </div>
                </>
              ) : (
                <div>Production unavailable</div>
              )}
            </div>
          }
          open={open}
          onOpen={() => setOpen(true)}
          onClose={(event) => {
            if ("key" in event && event.key === "Escape") close();
            else if (!pinned) setOpen(false);
          }}
          describeChild
          disableTouchListener
          disableInteractive={false}
          placement="top"
          slotProps={{
            tooltip: { className: "productionMixTooltip", ref: tooltipRef },
            popper: {
              modifiers: [
                {
                  name: "preventOverflow",
                  options: { padding: 16, altAxis: true },
                },
              ],
            },
          }}
        >
          <button
            type="button"
            className="productionMixTarget"
            aria-label="Inspect current production mix"
            onClick={() => {
              setOpen(!pinned);
              setPinned(!pinned);
            }}
            onBlur={close}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                close();
              }
              const tooltip = tooltipRef.current;
              if (open && tooltip) {
                const scroll: Partial<Record<string, number>> = {
                  ArrowDown: 24,
                  ArrowUp: -24,
                  PageDown: tooltip.clientHeight,
                  PageUp: -tooltip.clientHeight,
                  Home: -tooltip.scrollHeight,
                  End: tooltip.scrollHeight,
                };
                const distance = scroll[event.key];
                if (distance !== undefined) {
                  event.preventDefault();
                  tooltip.scrollTop += distance;
                }
              }
            }}
          >
            <span className="productionMixTrack" aria-hidden="true">
              {sources
                .filter((source) => source.watts > 0)
                .map((source) => (
                  <span
                    key={source.name}
                    className="productionMixSegment"
                    data-testid="production-mix-segment"
                    style={{
                      width: `${(source.watts / total) * 100}%`,
                      backgroundColor: source.color,
                    }}
                  />
                ))}
            </span>
          </button>
        </Tooltip>
      </div>
    </ClickAwayListener>
  );
}
