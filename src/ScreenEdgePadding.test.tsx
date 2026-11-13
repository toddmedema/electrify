import { act, render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { Menu, MenuItem, Popover } from "@mui/material";
import { ThemedApp } from "./App";
import settingsReducer, { change, initialSettings } from "./reducers/Settings";
import { normalizeScreenEdgePadding } from "./ScreenEdgePadding";
import ManualHelpPopover, {
  setManualHelpAnchor,
} from "./components/base/ManualHelpPopover";
import { MANUAL_ENTRY } from "./components/base/ManualEntries";

const originalViewport = {
  innerWidth: Object.getOwnPropertyDescriptor(window, "innerWidth")!,
  innerHeight: Object.getOwnPropertyDescriptor(window, "innerHeight")!,
};

afterEach(() => {
  Object.defineProperties(window, originalViewport);
  document.documentElement.style.removeProperty("--screen-edge-inset");
  document.documentElement.style.removeProperty("font-size");
  delete document.documentElement.dataset.interfaceScale;
  localStorage.clear();
  setManualHelpAnchor(null);
  jest.restoreAllMocks();
});

it.each([undefined, null, NaN, -4, 3, 100, "4", true])(
  "rejects invalid runtime padding: %p",
  (value) => {
    expect(normalizeScreenEdgePadding(value)).toBe(0);
  },
);

it.each(["popover", "menu", "manual"] as const)(
  "keeps %s inside the frame padding independently across scale and resize",
  (overlay) => {
    const store = configureStore({
      reducer: { settings: settingsReducer },
      preloadedState: {
        settings: {
          ...initialSettings,
          screenEdgePadding: 4 as const,
        },
      },
    });
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    jest.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
      width: 40,
      height: 40,
      top: -100,
      bottom: -60,
      left: -100,
      right: -60,
      x: -100,
      y: -100,
      toJSON: () => undefined,
    });
    setManualHelpAnchor(anchor);
    render(
      <Provider store={store}>
        <ThemedApp>
          <>
            {overlay === "popover" && (
              <Popover
                open
                anchorReference="anchorPosition"
                anchorPosition={{ top: 0, left: 0 }}
                slotProps={{
                  paper: { role: "dialog", "aria-label": "Overlay" },
                }}
              >
                <div>Overlay</div>
              </Popover>
            )}
            {overlay === "menu" && (
              <Menu
                open
                anchorReference="anchorPosition"
                anchorPosition={{ top: 0, left: 0 }}
                slotProps={{
                  paper: { role: "dialog", "aria-label": "Overlay" },
                }}
              >
                <MenuItem>Overlay</MenuItem>
              </Menu>
            )}
            {overlay === "manual" && (
              <ManualHelpPopover
                entry={MANUAL_ENTRY.POWER_AND_ENERGY}
                onClose={() => undefined}
                onRelated={() => undefined}
              />
            )}
          </>
        </ThemedApp>
      </Provider>,
    );
    const paper = screen.getByRole("dialog", {
      name: overlay === "manual" ? "Manual help" : "Overlay",
    });
    const expected = `${Math.ceil(Math.min(window.innerWidth, window.innerHeight) * 0.04)}px`;
    expect(
      document.documentElement.style.getPropertyValue("--screen-edge-inset"),
    ).toBe(expected);
    expect(paper).toHaveStyle({ top: expected, left: expected });
    act(() => {
      store.dispatch(change({ interfaceScale: 2.5, workspace: "single" }));
    });
    expect(
      document.documentElement.style.getPropertyValue("--screen-edge-inset"),
    ).toBe(expected);
    expect(paper).toHaveStyle({ top: expected, left: expected });
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 360 },
      innerHeight: { configurable: true, value: 640 },
    });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(
      document.documentElement.style.getPropertyValue("--screen-edge-inset"),
    ).toBe("15px");
    expect(paper).toHaveStyle({
      top: overlay === "manual" ? "15px" : "16px",
      left: overlay === "manual" ? "15px" : "16px",
    });
    anchor.remove();
  },
);
