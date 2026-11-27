import * as React from "react";
import {
  Draggable,
  type DraggableProvided,
  type DroppableProvided,
} from "@hello-pangea/dnd";
import { TransitionGroup } from "react-transition-group";
import RemovalCollapse from "./RemovalCollapse";

type DragProps = Pick<
  React.ComponentProps<typeof Draggable>,
  "draggableId" | "index" | "isDragDisabled"
>;
type CollapseProps = Pick<
  React.ComponentProps<typeof RemovalCollapse>,
  "animate" | "in" | "onExited"
>;
type RowDragProps = Partial<DraggableProvided>;

type Props = DragProps &
  CollapseProps & {
    children: (
      provided: RowDragProps,
      snapshot: { isDragging: boolean },
    ) => React.ReactNode;
  };

/** Keep the row painted during exit while removing it from dispatch-order indexing immediately. */
export default function RemovableDraggable({
  animate,
  children,
  draggableId,
  index,
  in: present,
  isDragDisabled,
  onExited,
}: Props) {
  return (
    <RemovalCollapse animate={animate} in={present} onExited={onExited}>
      {present === false ? (
        children({}, { isDragging: false })
      ) : (
        <Draggable
          draggableId={draggableId}
          index={index}
          isDragDisabled={isDragDisabled}
          disableInteractiveElementBlocking
        >
          {children}
        </Draggable>
      )}
    </RemovalCollapse>
  );
}

function DroppableList({
  children,
  label,
  provided,
}: {
  children: React.ReactElement[];
  label: string;
  provided: DroppableProvided;
}) {
  return (
    <div
      {...provided.droppableProps}
      ref={provided.innerRef}
      role="list"
      aria-label={label}
    >
      {children}
      {provided.placeholder}
    </div>
  );
}

/** Only the rows are transition children; the drag placeholder remains managed by DnD. */
export function RemovableDragList(
  props: React.ComponentProps<typeof DroppableList> & {
    childFactory?: (child: React.ReactElement) => React.ReactElement;
  },
) {
  return <TransitionGroup component={DroppableList} {...props} />;
}
