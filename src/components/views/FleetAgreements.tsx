import { ListItem } from "@mui/material";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import type { GameType, ReprioritizePowerAgreementAction } from "../../Types";
import {
  agreementDate,
  dispatchOrderedAgreements,
} from "../../helpers/PowerAgreements";
import { formatWatts, formatWattsOfPeak } from "../../helpers/Format";
import { currentTick } from "../../helpers/GameSelectors";
import FacilityRowText from "../base/FacilityRowText";
import FlowBar from "../base/FlowBar";
import UtilityLogoIcon from "../base/UtilityLogoIcon";
import { gameUtilityBranding } from "../../helpers/UtilityBranding";

export default function FleetAgreements({
  game,
  onDragStart,
  onDragEnd,
}: {
  game: GameType;
  onDragStart: () => void;
  onDragEnd: (move: ReprioritizePowerAgreementAction | null) => void;
}) {
  const agreements = dispatchOrderedAgreements(game);
  const branding = gameUtilityBranding(game);
  const tick = currentTick(game);
  const importedW = tick?.importedW ?? 0;
  const exportedW = tick?.exportedW ?? 0;
  const contractedW = tick?.entitlementImportedW ?? 0;
  const exchange = [
    importedW > 0 ? `Importing ${formatWatts(importedW)}` : "",
    exportedW > 0 ? `Exporting ${formatWatts(exportedW)}` : "",
  ].filter(Boolean);
  const meteredW = tick?.agreementImportedW;
  // Older saves have energy readings for settled intervals. Use their shares of
  // total contract imports until the next dispatch provides per-contract watts.
  const settledMWh = tick?.agreementUsefulMWh ?? {};
  const totalMWh = meteredW
    ? 0
    : Object.values(settledMWh).reduce((sum, mwh) => sum + mwh, 0);
  const wattsPerMWh = totalMWh > 0 ? contractedW / totalMWh : 0;
  const awaitingReading = !meteredW && !totalMWh && contractedW > 0;
  return (
    <section className="fleetAgreements" aria-label="Fleet trade">
      <div className="facilitySectionLabel fleetAgreementsHeading">
        <strong>Trade</strong>
        <span className="facilitySectionFlow">
          {exchange.join(" · ") || "No imports or exports"}
        </span>
      </div>
      <DragDropContext
        onBeforeDragStart={onDragStart}
        // Keep the top and bottom visible rows reachable before a short Fleet pane scrolls.
        autoScrollerOptions={{ startFromPercentage: 0.12 }}
        onDragEnd={({ source, destination, draggableId }) => {
          const target = destination && agreements[destination.index];
          if (!destination || !target || target.id === draggableId) {
            onDragEnd(null);
            return;
          }
          onDragEnd({
            id: draggableId,
            targetId: target.id,
            place: destination.index < source.index ? "before" : "after",
          });
        }}
      >
        <Droppable droppableId="fleet-agreements">
          {(list) => (
            <div
              ref={list.innerRef}
              {...list.droppableProps}
              role="list"
              aria-label="Trade dispatch order"
            >
              {agreements.map((agreement, index) => {
                const logo = branding.forTrade(agreement.id);
                const ratingW = agreement.nominalW * agreement.deliverability;
                const flowW = agreement.active
                  ? (meteredW?.[agreement.id] ??
                    (settledMWh[agreement.id] ?? 0) * wattsPerMWh)
                  : 0;
                const status = !agreement.active
                  ? `Starts ${agreementDate(agreement.startMinute)}`
                  : awaitingReading
                    ? "Awaiting flow reading"
                    : `${flowW > 0 ? "Importing" : "Idle"} · ${formatWattsOfPeak(flowW, ratingW)}`;
                return (
                  <Draggable
                    key={agreement.id}
                    draggableId={agreement.id}
                    index={index}
                    disableInteractiveElementBlocking
                  >
                    {(row, snapshot) => (
                      <div
                        ref={row.innerRef}
                        {...row.draggableProps}
                        role="listitem"
                        className={`fleetAgreementRow${snapshot.isDragging ? " dragging" : ""}`}
                      >
                        <div className="facilityRowHeader">
                          <FlowBar fraction={flowW / ratingW} />
                          <button
                            type="button"
                            {...row.dragHandleProps}
                            className="facilityDisclosure fleetAgreementDragHandle"
                            aria-label={`Reorder ${agreement.name}, ${status}`}
                          >
                            <ListItem className="facility" component="span">
                              <DragIndicatorIcon
                                className="fleetAgreementGrip"
                                aria-hidden
                              />
                              <UtilityLogoIcon
                                logo={logo}
                                className="transmissionListIcon"
                              />
                              <FacilityRowText
                                name={
                                  <span className="facilityName">
                                    {agreement.name}
                                  </span>
                                }
                                status={status}
                              />
                            </ListItem>
                          </button>
                        </div>
                      </div>
                    )}
                  </Draggable>
                );
              })}
              {list.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </section>
  );
}
