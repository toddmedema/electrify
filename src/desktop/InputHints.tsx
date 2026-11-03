import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@mui/material";
import { useAppDispatch } from "../Store";
import { dialogOpen } from "../reducers/GameActions";
import { useTvLayout } from "../TvLayout";
import type { DesktopInputAction, DesktopInputFrame } from "../Desktop";
import {
  getInputPresentation,
  subscribeInputPresentation,
} from "./InputPresentation";
import { editableTextControl } from "./InputText";
import "./Input.scss";

const menuHints: [DesktopInputAction, string][] = [
  ["down", "Navigate"],
  ["confirm", "Select"],
  ["back", "Back"],
];
const gameHints: [DesktopInputAction, string][] = [
  ["down", "Navigate"],
  ["confirm", "Select"],
  ["back", "Back / menu"],
  ["pause", "Pause / resume"],
  ["speedDown", "Slower"],
  ["speedUp", "Faster"],
  ["previousPane", "Previous pane"],
  ["nextPane", "Next pane"],
  ["build", "Build"],
  ["previousChart", "Previous chart"],
  ["nextChart", "Next chart"],
];
type Hint = [DesktopInputAction, string];
function contextualHints(target: Element | null, gameplay: boolean): Hint[] {
  if (target?.matches('input[type="range"],[role="slider"]'))
    return [
      ["left", "Adjust value"],
      ["down", "Next control"],
      ["back", "Back"],
    ];
  if (target?.matches('.accessibleChart > [role="img"]'))
    return [
      ["confirm", "Inspect time"],
      ["left", "Read points"],
      ["back", "Close details"],
    ];
  if (target?.matches("[data-rfd-drag-handle-draggable-id]"))
    return [
      ["confirm", "Lift / drop"],
      ["up", "Move priority"],
      ["back", "Cancel reorder"],
    ];
  return [
    ["down", "Navigate"],
    ["confirm", editableTextControl(target) ? "Edit text" : "Select"],
    ["back", gameplay ? "Back / menu" : "Back"],
    ...(gameplay ? [["pause", "Pause / resume"] as Hint] : []),
  ];
}

export default function InputHints() {
  const state = useSyncExternalStore(
    subscribeInputPresentation,
    getInputPresentation,
  );
  const tvMode = useTvLayout();
  const dispatch = useAppDispatch();
  const [focused, setFocused] = useState<Element | null>(
    document.activeElement,
  );
  useEffect(() => {
    const update = () => setFocused(document.activeElement);
    document.addEventListener("focusin", update);
    return () => document.removeEventListener("focusin", update);
  }, []);
  if (!state.active && !state.pausedAfterDisconnect) return null;
  const hints = tvMode
    ? contextualHints(focused, state.context === "Gameplay")
    : state.context === "Gameplay"
      ? gameHints
      : menuHints;
  return (
    <>
      <aside className="controllerHints" aria-label="Controller controls">
        {state.pausedAfterDisconnect && (
          <p role="status">
            {state.connected
              ? "Controller reconnected."
              : "Controller disconnected."}{" "}
            Game paused. Select a speed to resume when ready.
          </p>
        )}
        {state.active && state.connected && (
          <div className="controllerHintActions">
            {hints.map((hint) => glyphHint(hint, state.glyphs))}
            {tvMode && (
              <Button
                className="controllerHelpButton"
                onClick={() =>
                  dispatch(
                    dialogOpen({
                      open: true,
                      title: "Controller controls",
                      message: <FullControlsHelp />,
                      closeText: "Close controls",
                      focusCancel: true,
                    }),
                  )
                }
              >
                All controls
              </Button>
            )}
          </div>
        )}
      </aside>
    </>
  );
}

function glyphHint([action, label]: Hint, glyphs: DesktopInputFrame["glyphs"]) {
  const glyph = glyphs[action];
  if (!glyph) return null;
  return (
    <span className="controllerHint" key={action}>
      {glyph.image ? (
        <img src={glyph.image} alt={glyph.label} />
      ) : (
        <span className="controllerHintBinding">{glyph.label}</span>
      )}
      <span>{label}</span>
    </span>
  );
}

/** The existing app dialog owns pause, Back and focus restoration; glyphs stay live when remapped. */
function FullControlsHelp() {
  const state = useSyncExternalStore(
    subscribeInputPresentation,
    getInputPresentation,
  );
  const allHints: Hint[] = [
    ["up", "Move up"],
    ["down", "Move down"],
    ["left", "Move left"],
    ["right", "Move right"],
    ...gameHints.slice(1),
  ];
  return (
    <>
      <p>
        Use the directional controls to follow visible rows. In a slider, Left
        and Right adjust the value; Up and Down move to another control.
      </p>
      <div className="controllerHelpGrid">
        {allHints.map((hint) => (
          <div key={hint[0]} tabIndex={0} className="controllerHelpRow">
            {glyphHint(hint, state.glyphs)}
          </div>
        ))}
      </div>
      <p>
        Select a chart to inspect values without a pointer. Back closes chart
        details, then the current tool, then opens the game menu. Select a
        reorder grip to lift or drop a facility; directional controls move it,
        and Back cancels.
      </p>
    </>
  );
}
