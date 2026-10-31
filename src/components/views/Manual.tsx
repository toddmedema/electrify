import { FEEDBACK_URL } from "../../CommunityLinks";
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
  Typography,
} from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import { ChevronDownGlyph } from "../base/Glyphs";
import SearchIcon from "@mui/icons-material/Search";
import ScreenPage from "../base/ScreenPage";
import {
  MANUAL_ENTRIES,
  MANUAL_ENTRY,
  MANUAL_GROUPS,
  ManualEntryTitleType,
  ManualEntryType,
  ManualGroupType,
  manualEntryText,
} from "../base/ManualEntries";
import { ManualEntryNavigation } from "../base/ManualEntryLink";

export interface StateProps {
  // Set when the player arrived via a deep link from a term shown elsewhere in the game
  // (see ManualLink) - that entry opens and scrolls into view
  focusEntry?: string;
  // Changes with every navigation, so following a link to the entry already in focusEntry (after
  // scrolling or searching away from it) still brings it back into view
  focusKey?: number;
}

export interface DispatchProps {
  // Leaves the manual, however many links deep the player went
  onBack: () => void;
  // Follows a link in one entry's prose to another, as a step Back can retrace
  onFollowLink: (to: ManualEntryTitleType, from: ManualEntryTitleType) => void;
}

export interface Props extends StateProps, DispatchProps {}

// The pinned group header's height (.manual-group's line-height in app.scss). A grouped entry
// scrolled into view must land below it, and its title pins at this offset while open. Keep
// the two in sync.
const GROUP_HEADER_HEIGHT = 32;

/** A touch-only device has no keys to learn; a tablet with a keyboard reports a fine pointer. */
const hideKeyboardEntry = (entry: ManualEntryType) =>
  entry.title === MANUAL_ENTRY.KEYBOARD_SHORTCUTS &&
  window.matchMedia("(hover: none) and (pointer: coarse)").matches &&
  !window.matchMedia("(any-pointer: fine)").matches;

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

// The list is the scroller, except on short windows where #gameCard takes over and the list
// stops scrolling (see app.scss). Scroll adjustments have to target whichever one actually is
function scrollContainerOf(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el;
  while (node && node !== document.body) {
    if (/(auto|scroll)/.test(window.getComputedStyle(node).overflowY)) {
      return node;
    }
    node = node.parentElement;
  }
  return document.documentElement;
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
  onTransitionStart: (title: string) => void;
  onTransitionEnd: (title: string) => void;
  onFollowLink: (to: ManualEntryTitleType, from: ManualEntryTitleType) => void;
}

function ManualItem(props: ManualItemProps): React.JSX.Element {
  const { entry, searchTerm, expanded, onFollowLink } = props;
  const id = entryId(entry.title);
  const { onTransitionEnd } = props;
  React.useEffect(
    () => () => onTransitionEnd(entry.title),
    [entry.title, onTransitionEnd],
  );
  const followLink = React.useCallback(
    (to: ManualEntryTitleType) => onFollowLink(to, entry.title),
    [onFollowLink, entry.title],
  );
  return (
    <Accordion
      className={entry.pinned ? "manual-entry manual-pinned" : "manual-entry"}
      expanded={expanded}
      onChange={(_event: React.SyntheticEvent, isExpanded: boolean) =>
        props.onToggle(entry.title, isExpanded)
      }
      ref={props.itemRef}
      square
      disableGutters
      slotProps={{
        transition: {
          unmountOnExit: true,
          onEnter: () => props.onTransitionStart(entry.title),
          onExit: () => props.onTransitionStart(entry.title),
          onEntered: () => onTransitionEnd(entry.title),
          onExited: () => onTransitionEnd(entry.title),
        },
      }}
    >
      <AccordionSummary
        expandIcon={<ChevronDownGlyph className="rowChevron" />}
        aria-controls={`${id}-content`}
        id={`${id}-header`}
      >
        <Typography variant="h6" component="span">
          {highlight(entry.title, searchTerm, `${id}-title`)}
        </Typography>
      </AccordionSummary>
      <AccordionDetails id={`${id}-content`}>
        <ManualEntryNavigation.Provider value={followLink}>
          {highlight(entry.entry, searchTerm, id)}
        </ManualEntryNavigation.Provider>
      </AccordionDetails>
    </Accordion>
  );
}

export default function Manual(props: Props): React.JSX.Element {
  const { onBack, onFollowLink } = props;
  const [focusEntry, setFocusEntry] = React.useState(props.focusEntry);
  const [focusRequest, setFocusRequest] = React.useState(0);
  // A deep link is a fresh question, so it ignores (and clears) whatever the last visit left
  const [searchTerm, setSearchTerm] = React.useState<string>(
    focusEntry ? "" : lastSearchTerm,
  );
  // Which entries the player has explicitly opened or closed. Anything not in here falls back
  // to the default for the current mode: open while searching, closed while browsing
  const [toggled, setToggled] = React.useState<Record<string, boolean>>({});
  const listRef = React.useRef<HTMLDivElement>(null);
  const focusRef = React.useRef<HTMLDivElement>(null);
  const transitioning = React.useRef(new Set<string>());
  const revealRequested = React.useRef(false);
  const revealFrame = React.useRef(0);
  React.useEffect(() => () => cancelAnimationFrame(revealFrame.current), []);
  const revealFocusedEntry = React.useCallback(() => {
    if (!revealRequested.current || transitioning.current.size) return;
    cancelAnimationFrame(revealFrame.current);
    revealFrame.current = requestAnimationFrame(() => {
      const focused = focusRef.current;
      if (!revealRequested.current || transitioning.current.size || !focused)
        return;
      revealRequested.current = false;
      if (listRef.current) {
        const scroller = scrollContainerOf(listRef.current);
        const top =
          scroller === document.documentElement
            ? 0
            : scroller.getBoundingClientRect().top;
        const header = focused.classList.contains("manual-pinned")
          ? 0
          : GROUP_HEADER_HEIGHT;
        // Apply the header offset before the browser clamps at the end of the list.
        scroller.scrollTop +=
          focused.getBoundingClientRect().top - top - header;
      }
    });
  }, []);
  const onTransitionStart = React.useCallback((title: string) => {
    transitioning.current.add(title);
  }, []);
  const onTransitionEnd = React.useCallback(
    (title: string) => {
      transitioning.current.delete(title);
      revealFocusedEntry();
    },
    [revealFocusedEntry],
  );

  const term = searchTerm.trim().toLowerCase();
  const searching = term.length > 0;

  // Entering or leaving search changes what "expanded" defaults to, so the player's per-entry
  // overrides from the other mode no longer mean anything
  const wasSearching = React.useRef(searching);
  if (wasSearching.current !== searching) {
    wasSearching.current = searching;
    setToggled({});
  }

  const openEntry = React.useCallback((title: string) => {
    setSearchTerm("");
    setToggled({ [title]: true });
    setFocusEntry(title);
    // Revisit requests matter even when the entry title has not changed:
    // searching may have hidden it and moved keyboard focus elsewhere.
    setFocusRequest((request) => request + 1);
  }, []);

  React.useEffect(() => {
    if (props.focusEntry) openEntry(props.focusEntry);
  }, [props.focusEntry, props.focusKey, openEntry]);

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

  React.useLayoutEffect(() => {
    if (focusEntry && focusRef.current) {
      // Focus without the browser scrolling to an intermediate accordion height.
      focusRef.current
        .querySelector<HTMLButtonElement>(".MuiAccordionSummary-root")
        ?.focus({ preventScroll: true });
      revealRequested.current = true;
      // A link can both collapse earlier entries and expand its target. Align only once
      // all those transitions finish, or the closing content moves the target again.
      revealFocusedEntry();
    }
  }, [focusEntry, focusRequest, revealFocusedEntry]);

  const matches = React.useMemo(
    () =>
      searching
        ? SORTED_ENTRIES.filter((entry: ManualEntryType) =>
            SEARCH_TEXT[entry.title].includes(term),
          )
        : SORTED_ENTRIES.filter((entry) => !hideKeyboardEntry(entry)),
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
        onFollowLink={onFollowLink}
        onTransitionStart={onTransitionStart}
        onTransitionEnd={onTransitionEnd}
        itemRef={isFocused ? focusRef : undefined}
      />
    );
  };

  const pinned = matches.filter((entry: ManualEntryType) => entry.pinned);

  return (
    <ScreenPage
      id="gameCard"
      title="Manual"
      onBack={onBack}
      trailing={
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
              <SearchIcon color="action" fontSize="small" />
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
      }
    >
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
        {matches.length === 0 && (
          <div className="manual-empty">
            <Typography variant="body1">
              No entries match "{searchTerm}".
            </Typography>
            <Typography variant="body2">
              Missing something? <a href={FEEDBACK_URL}>Let us know</a>.
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
    </ScreenPage>
  );
}
