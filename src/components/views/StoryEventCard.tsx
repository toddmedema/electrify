import * as React from "react";
import EventCard from "../base/EventCard";
import ConceptIcon from "../base/ConceptIcon";
import { UpcomingStoryEventType } from "./StoryEventSelectors";

type Props = Omit<
  React.ComponentProps<typeof EventCard>,
  "icon" | "heading" | "meta" | "children"
> & {
  event: UpcomingStoryEventType;
};

/** An ongoing or announced story event, in the same card as the Events history. */
export default function StoryEventCard({
  event,
  className,
  ...rest
}: Props): React.JSX.Element {
  return (
    <EventCard
      {...rest}
      className={`importance-${event.importance || "ROUTINE"}${className ? ` ${className}` : ""}`}
      icon={
        <ConceptIcon concept={event.concept || "forecast"} fontSize="small" />
      }
      heading={event.title}
      meta={event.label}
    >
      {event.message}
    </EventCard>
  );
}
