import * as React from "react";
import { chartPalette, withAlpha } from "../../Theme";

/**
 * The tint behind a fleet row saying how hard the thing is working, signed so that power moving
 * the other way -- a battery charging, an intertie selling to a neighbour -- is as visible as
 * power moving out. Both directions fill from the left edge at |flow| / rating, which keeps one
 * bar grammar across generator, storage and intertie rows and keeps full resolution at 320px.
 *
 * Direction is carried by three redundant channels rather than hue alone (WCAG 1.4.1): the
 * colour, a diagonal hatch, and -- outside this component -- the row's own signed reading and
 * the up/down activity badge on the icon. That matters most at 100%, where a reverse bar and a
 * forward bar cover exactly the same pixels.
 *
 * Forward flow keeps the compositor-friendly `scaleX` it has always used. Reverse flow sizes
 * with `width` instead, because `scaleX` squashes the hatch along with the fill -- the same
 * trap the construction bar's glow head fell into. Reverse flow is the rarer state, so the
 * common path keeps its transform transition untouched.
 */
export default function FlowBar(props: {
  /** Signed share of rating: positive generating, discharging or importing. */
  fraction: number;
  /** The accent this row is tinted with when power flows the normal way. */
  color: string;
}): React.JSX.Element {
  const reverse = props.fraction < 0;
  const magnitude = Math.min(1, Math.abs(props.fraction) || 0);
  // Reverse flow borrows the battery blue, which already means "storing" on the capacity bar
  const tint = withAlpha(reverse ? chartPalette().storage : props.color, 0.18);
  return (
    <div
      className={`outputProgressBar${reverse ? " reverseFlow" : ""}`}
      aria-hidden="true"
      // backgroundColor, never the `background` shorthand: the shorthand would reset the hatch
      // that the stylesheet layers on top of reverse flow.
      style={
        reverse
          ? { width: `${magnitude * 100}%`, backgroundColor: tint }
          : { transform: `scaleX(${magnitude})`, backgroundColor: tint }
      }
    />
  );
}
