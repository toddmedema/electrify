import * as React from "react";
import { useDispatch } from "react-redux";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import type { AppDispatch } from "../../Store";
import { navigate } from "../../reducers/Card";
import type { ManualEntryTitleType } from "../../data/Manual";

interface Props {
  entry: ManualEntryTitleType;
  // The term as it reads on screen, if it differs from the entry's title
  label?: string;
}

// A term the game already shows, turned into a way into the manual. Without these the search
// box only helps players who already know the term exists, which is the wrong way round.
export default function ManualLink(props: Props): React.JSX.Element {
  const dispatch = useDispatch<AppDispatch>();
  const label = props.label || props.entry;
  return (
    <button
      type="button"
      className="manual-link"
      aria-label={`What is ${label}?`}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        // These sit inside rows that expand when clicked, and looking a term up shouldn't
        // also toggle the row underneath it
        event.stopPropagation();
        dispatch(navigate({ name: "MANUAL", entry: props.entry }));
      }}
    >
      <HelpOutlineIcon fontSize="inherit" />
    </button>
  );
}
