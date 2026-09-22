import * as React from "react";
import { Button, Typography } from "@mui/material";
import { getStorageBoolean, setStorageKeyValue } from "../../LocalStorage";

const SEEN_KEY = "hydroPrimerSeen";

/**
 * Hydro breaks two assumptions every other generator on the list teaches: that you can build as
 * many as you can afford, and that output is limited only by the plant. Said once, where the
 * player first meets it, then out of the way for good.
 */
export function useHydroPrimer(): [boolean, () => void] {
  const [visible, setVisible] = React.useState(
    () => !getStorageBoolean(SEEN_KEY, false),
  );
  const dismiss = React.useCallback(() => {
    setStorageKeyValue(SEEN_KEY, true);
    setVisible(false);
  }, []);
  return [visible, dismiss];
}

export default function HydroPrimer(props: {
  place: string;
  totalSites: number;
  onDismiss: () => void;
}): React.JSX.Element {
  const titleId = React.useId();
  return (
    <section className="buildPrimer" aria-labelledby={titleId}>
      <Typography id={titleId} variant="subtitle2" component="h2">
        How hydro differs
      </Typography>
      <Typography variant="body2">
        You can build {props.totalSites} hydro{" "}
        {props.totalSites === 1 ? "project" : "projects"} near {props.place},
        each using the smallest remaining site that fits its capacity. Smaller
        builds still consume a whole site. Cancelling unfinished construction
        releases the site; once commissioned, selling or retiring the plant
        never releases it. The reservoir only refills from rain and snowmelt.
      </Typography>
      <Button size="small" onClick={props.onDismiss}>
        Got it
      </Button>
    </section>
  );
}
