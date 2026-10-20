import { useSyncExternalStore } from "react";
import type { DesktopInputAction } from "../Desktop";
import { getInputPresentation, subscribeInputPresentation } from "./Input";
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
export default function InputHints() {
  const state = useSyncExternalStore(
    subscribeInputPresentation,
    getInputPresentation,
  );
  if (!state.active && !state.pausedAfterDisconnect) return null;
  return (
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
          {(state.context === "Gameplay" ? gameHints : menuHints).map(
            ([action, label]) => {
              const glyph = state.glyphs[action];
              if (!glyph) return null;
              return (
                <span key={action} className="controllerHint">
                  {glyph.image ? (
                    <img src={glyph.image} alt={glyph.label} />
                  ) : (
                    <span className="controllerHintBinding">{glyph.label}</span>
                  )}
                  <span>{label}</span>
                </span>
              );
            },
          )}
        </div>
      )}
    </aside>
  );
}
