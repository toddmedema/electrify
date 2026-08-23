import * as React from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  IconButton,
  InputAdornment,
  InputBase,
  List,
  ListSubheader,
  Toolbar,
  Typography,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ClearIcon from "@mui/icons-material/Clear";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SearchIcon from "@mui/icons-material/Search";
import {
  MANUAL_ENTRIES,
  MANUAL_GROUPS,
  ManualEntryType,
  ManualGroupType,
  manualEntryText,
} from "../../data/Manual";

export interface StateProps {
  // Set when the player arrived via a deep link from a term shown elsewhere in the game
  // (see ManualLink) - that entry opens and scrolls into view
  focusEntry?: string;
}

export interface DispatchProps {
  onBack: () => void;
}

export interface Props extends StateProps, DispatchProps {}

const DISCORD_URL = "https://discord.gg/2fTDHE7";

// Pinned first, then by group in the order the groups are declared, then alphabetically. Sorted
// once here rather than on every keystroke
const SORTED_ENTRIES = [...MANUAL_ENTRIES].sort((a, b) => {
  if (Boolean(a.pinned) !== Boolean(b.pinned)) {
    return a.pinned ? -1 : 1;
  }
  const groupDelta =
    MANUAL_GROUPS.indexOf(a.group) - MANUAL_GROUPS.indexOf(b.group);
  return groupDelta !== 0 ? groupDelta : a.title.localeCompare(b.title);
});

// Everything an entry can be found by, lowercased once at load
const SEARCH_TEXT: Record<string, string> = {};
SORTED_ENTRIES.forEach((entry: ManualEntryType) => {
  SEARCH_TEXT[entry.title] =
    `${entry.title} ${entry.keywords || ""} ${manualEntryText(entry.entry)}`.toLowerCase();
});

// The manual unmounts whenever the player leaves it, so "where was I" has to live outside the
// component: looking up a second term shouldn't mean re-typing the first one and scrolling back
// down the list. Deep links deliberately start fresh instead (see below).
let lastSearchTerm = "";
let lastScrollTop = 0;

export function clearManualMemory() {
  lastSearchTerm = "";
  lastScrollTop = 0;
}

function entryId(title: string): string {
  return `manual-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

// Wraps each occurrence of the search term in a <mark>, so a hit inside a long entry is
// findable by eye rather than by re-reading the paragraph
function markMatches(
  text: string,
  term: string,
  keyPrefix: string,
): React.ReactNode {
  const haystack = text.toLowerCase();
  if (haystack.indexOf(term) === -1) {
    return text;
  }
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let n = 0;
  let found = haystack.indexOf(term);
  while (found !== -1) {
    if (found > cursor) {
      parts.push(text.slice(cursor, found));
    }
    parts.push(
      <mark key={`${keyPrefix}-${n++}`}>
        {text.slice(found, found + term.length)}
      </mark>,
    );
    cursor = found + term.length;
    found = haystack.indexOf(term, cursor);
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return parts;
}

// Rebuilds an entry's markup with the matches highlighted. Walks the whole tree rather than
// just the top level, since that's where the interesting text is
function highlight(
  node: React.ReactNode,
  term: string,
  keyPrefix = "m",
): React.ReactNode {
  if (!term) {
    return node;
  }
  if (typeof node === "string") {
    return markMatches(node, term, keyPrefix);
  }
  if (Array.isArray(node)) {
    return node.map((child: React.ReactNode, i: number) => (
      <React.Fragment key={i}>
        {highlight(child, term, `${keyPrefix}-${i}`)}
      </React.Fragment>
    ));
  }
  if (React.isValidElement(node)) {
    const children = (node.props as { children?: React.ReactNode }).children;
    // Void elements (<img>) and component elements (<KeyboardShortcuts/>) have nothing to
    // walk - their text, if any, only exists once React renders them
    if (children === undefined) {
      return node;
    }
    return React.cloneElement(
      node as React.ReactElement<{ children?: React.ReactNode }>,
      undefined,
      highlight(children, term, keyPrefix),
    );
  }
  return node;
}

interface ManualItemProps {
  entry: ManualEntryType;
  searchTerm: string;
  expanded: boolean;
  onToggle: (title: string, expanded: boolean) => void;
  itemRef?: React.Ref<HTMLDivElement>;
}

function ManualItem(props: ManualItemProps): React.JSX.Element {
  const { entry, searchTerm, expanded } = props;
  const id = entryId(entry.title);
  return (
    <Accordion
      className="manual-entry"
      expanded={expanded}
      onChange={(_event: React.SyntheticEvent, isExpanded: boolean) =>
        props.onToggle(entry.title, isExpanded)
      }
      ref={props.itemRef}
      square
      disableGutters
      slotProps={{ transition: { unmountOnExit: true } }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon color="primary" />}
        aria-controls={`${id}-content`}
        id={`${id}-header`}
      >
        <Typography variant="h6" component="span">
          {highlight(entry.title, searchTerm, `${id}-title`)}
        </Typography>
      </AccordionSummary>
      <AccordionDetails id={`${id}-content`}>
        {highlight(entry.entry, searchTerm, id)}
      </AccordionDetails>
    </Accordion>
  );
}

export default function Manual(props: Props): React.JSX.Element {
  const { focusEntry, onBack } = props;
  // A deep link is a fresh question, so it ignores (and clears) whatever the last visit left
  const [searchTerm, setSearchTerm] = React.useState<string>(
    focusEntry ? "" : lastSearchTerm,
  );
  // Which entries the player has explicitly opened or closed. Anything not in here falls back
  // to the default for the current mode: open while searching, closed while browsing
  const [toggled, setToggled] = React.useState<Record<string, boolean>>({});
  const listRef = React.useRef<HTMLDivElement>(null);
  const focusRef = React.useRef<HTMLDivElement>(null);

  const term = searchTerm.trim().toLowerCase();
  const searching = term.length > 0;

  // Entering or leaving search changes what "expanded" defaults to, so the player's per-entry
  // overrides from the other mode no longer mean anything
  const wasSearching = React.useRef(searching);
  if (wasSearching.current !== searching) {
    wasSearching.current = searching;
    setToggled({});
  }

  React.useEffect(() => {
    lastSearchTerm = searchTerm;
  }, [searchTerm]);

  // Restore the scroll position from the last visit. Before paint, so the list doesn't flash
  // at the top first - and a deep link scrolls to its own entry instead (below)
  React.useLayoutEffect(() => {
    if (listRef.current && !focusEntry) {
      listRef.current.scrollTop = lastScrollTop;
    }
  }, [focusEntry]);

  React.useEffect(() => {
    const focused = focusRef.current;
    // jsdom has no layout, and so no scrollIntoView
    if (focusEntry && focused && focused.scrollIntoView) {
      focused.scrollIntoView({ block: "start" });
    }
  }, [focusEntry]);

  const matches = React.useMemo(
    () =>
      searching
        ? SORTED_ENTRIES.filter((entry: ManualEntryType) =>
            SEARCH_TEXT[entry.title].includes(term),
          )
        : SORTED_ENTRIES,
    [searching, term],
  );

  const onToggle = React.useCallback((title: string, expanded: boolean) => {
    setToggled((previous: Record<string, boolean>) => ({
      ...previous,
      [title]: expanded,
    }));
  }, []);

  const renderEntry = (entry: ManualEntryType) => {
    const isFocused = entry.title === focusEntry;
    return (
      <ManualItem
        key={entry.title}
        entry={entry}
        searchTerm={term}
        expanded={toggled[entry.title] ?? (searching || isFocused)}
        onToggle={onToggle}
        itemRef={isFocused ? focusRef : undefined}
      />
    );
  };

  const pinned = matches.filter((entry: ManualEntryType) => entry.pinned);

  return (
    <div className="flexContainer" id="gameCard">
      <div id="topbar">
        <Toolbar>
          <IconButton
            onClick={onBack}
            aria-label="back"
            edge="start"
            color="primary"
            size="large"
          >
            <ChevronLeftIcon />
          </IconButton>
          <Typography variant="h6">Electrify Manual</Typography>
          <InputBase
            className="manual-search"
            placeholder="Search..."
            value={searchTerm}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setSearchTerm(event.target.value)
            }
            inputProps={{ "aria-label": "Search the manual" }}
            startAdornment={
              <InputAdornment position="start">
                <SearchIcon color="primary" fontSize="small" />
              </InputAdornment>
            }
            endAdornment={
              searchTerm ? (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => setSearchTerm("")}
                    aria-label="clear search"
                    color="primary"
                    size="small"
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : null
            }
          />
        </Toolbar>
      </div>
      <List
        dense
        component="div"
        className="scrollable cardList"
        id="manual"
        ref={listRef}
        // Recorded as it happens rather than on unmount: by the time an unmount cleanup runs,
        // React has already detached the node and every detached node reports a scrollTop of 0
        onScroll={(event: React.UIEvent<HTMLDivElement>) => {
          lastScrollTop = event.currentTarget.scrollTop;
        }}
      >
        <Typography variant="caption" component="p" className="manual-intro">
          Look up terms and mechanics to learn more about how they work in game
          - and in real life.
        </Typography>
        {matches.length === 0 && (
          <div className="manual-empty">
            <Typography variant="body1">
              No entries match "{searchTerm}".
            </Typography>
            <Typography variant="body2">
              Think it belongs in here? Ask us on{" "}
              <a href={DISCORD_URL} target="_blank" rel="noreferrer">
                Discord
              </a>
              .
            </Typography>
          </div>
        )}
        {pinned.map(renderEntry)}
        {MANUAL_GROUPS.map((group: ManualGroupType) => {
          const entries = matches.filter(
            (entry: ManualEntryType) => !entry.pinned && entry.group === group,
          );
          if (entries.length === 0) {
            return null;
          }
          return (
            <React.Fragment key={group}>
              <ListSubheader component="div" className="manual-group">
                {group}
              </ListSubheader>
              {entries.map(renderEntry)}
            </React.Fragment>
          );
        })}
      </List>
    </div>
  );
}
