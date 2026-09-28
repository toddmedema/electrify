import * as React from "react";
import { chartPalette, withAlpha } from "../../Theme";

/**
 * The tint behind a fleet row saying how hard the thing is working, signed so that power moving
 * the other way -- a battery charging, an intertie selling to a neighbour -- is as visible as
 * power moving out. Both directions fill from the left edge at |flow| / rating, which keeps one
 * bar grammar across generator, storage and intertie rows and keeps full resolution at 320px.
 *
 * Direction needs more than hue (WCAG 1.4.1), and most of all at 100%, where a reverse bar
 * and a forward bar cover exactly the same pixels. This component contributes the colour and a
 * diagonal hatch; the rest is the row's, and differs by row. A storage row reads out stored
 * energy, which never goes negative, so its direction rides on the up/down activity badge over
 * its icon and the "charging"/"discharging" it appends to the reading. An intertie row has no
 * badge -- its icon is a bare decorative image -- and carries direction in its signed reading
 * and in the row button's own accessible name.
 *
 * Forward flow is one neutral tint on every row, whatever the fuel: a fuel-coloured fill turned
 * a gas row lavender, which reads as a selected state, and the fuel is already the icon's job.
 *
 * Forward flow keeps the compositor-friendly `scaleX` it has always used. Reverse flow sizes
 * with `width` instead, because `scaleX` squashes the hatch along with the fill -- the same
 * trap the construction bar's glow head fell into. Reverse flow is the rarer state, so the
 * common path keeps its transform transition untouched.
 */
export default function FlowBar(props: {
  /** Signed share of rating: positive generating, discharging or importing. */
  fraction: number;
}): React.JSX.Element {
  const reverse = props.fraction < 0;
  const magnitude = Math.min(1, Math.abs(props.fraction) || 0);
  // Reverse flow borrows the battery blue, which already means "storing" on the capacity bar
  // Forward flow takes the stylesheet's neutral --flow-fill
  const tint = withAlpha(chartPalette().storage, 0.18);
  return (
    <div
      className={`outputProgressBar${reverse ? " reverseFlow" : ""}`}
      aria-hidden="true"
      // backgroundColor, never the `background` shorthand: the shorthand would reset the hatch
      // that the stylesheet layers on top of reverse flow.
      style={
        reverse
          ? { width: `${magnitude * 100}%`, backgroundColor: tint }
          : { transform: `scaleX(${magnitude})` }
      }
    />
  );
}
