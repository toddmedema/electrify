import * as React from "react";
import { Button } from "@mui/material";
import ConceptIcon from "./ConceptIcon";
import { ActiveEventGroupType } from "../views/StoryEventSelectors";

interface Props {
  groups: ActiveEventGroupType[];
  onOpen: () => void;
}

function describeGroup(group: ActiveEventGroupType): string {
  const where = group.count > 1 ? ` at ${group.count} sites` : "";
  const severity = group.importance === "CRITICAL" ? " (critical)" : "";
  return `${group.title}${where}${severity}, ${group.throughLabel}`;
}

/**
 * What is happening to the grid right now: a borderless text button in the mission row's family,
 * sitting beside the grid readout rather than in a row of its own. It is exactly as tall as the
 * mission row's controls, so the status bar never grows; narrow rows trade the lead title for a
 * plain count via the slot's container queries.
 */
function ActiveEventsChip({ groups, onOpen }: Props) {
  if (groups.length === 0) {
    return null;
  }
  const lead = groups[0];
  const critical = groups.some((group) => group.importance === "CRITICAL");
  const description = `Active events: ${groups.map(describeGroup).join("; ")}.`;
  const more = groups.length - 1;
  return (
    <div className="activeEventsSlot">
      <Button
        className={`activeEventsChip${critical ? " activeEventsChip-critical" : ""}`}
        color="inherit"
        aria-label={`${description} Open Events.`}
        title={description}
        onClick={onOpen}
      >
        <span className="statusIcon activeEventsIcon" aria-hidden="true">
          <ConceptIcon concept={lead.concept ?? "forecast"} fontSize="small" />
        </span>
        <span className="activeEventsTitle">{lead.title}</span>
        {more > 0 && <span className="activeEventsMore">+{more}</span>}
        <span className="activeEventsCount">
          {groups.length} {groups.length === 1 ? "event" : "events"}
        </span>
      </Button>
    </div>
  );
}

export default React.memo(ActiveEventsChip);
