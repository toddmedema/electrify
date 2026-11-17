import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import TileWorkspaceSurface from "./TileWorkspaceSurface";

it("focuses new content without restoring the map until the surface closes", () => {
  const mapFocused = jest.fn();
  const show = (focusKey: number, title = "Build", open = true) => (
    <div className="territoryNetwork">
      <button className="territoryTileTarget" tabIndex={0}>
        Selected tile
      </button>
      <button className="territoryMapBuyToggle">Buy land</button>
      {open && (
        <TileWorkspaceSurface
          title={title}
          focusKey={focusKey}
          onClose={jest.fn()}
        >
          <button>Project control</button>
        </TileWorkspaceSurface>
      )}
    </div>
  );
  const { rerender } = render(show(1));
  screen
    .getByRole("button", { name: "Selected tile" })
    .addEventListener("focus", mapFocused);
  const heading = screen.getByRole("heading", { level: 3 });
  expect(heading).toHaveFocus();
  const control = screen.getByRole("button", { name: "Project control" });
  act(() => control.focus());
  rerender(show(1, "Updated display value"));
  expect(control).toHaveFocus();
  rerender(show(2));
  expect(heading).toHaveFocus();
  expect(mapFocused).not.toHaveBeenCalled();
  rerender(show(2, "Build", false));
  expect(screen.getByRole("button", { name: "Buy land" })).toHaveFocus();
  expect(mapFocused).not.toHaveBeenCalled();
});

it("leaves Escape to a nested modal before closing the tile surface", () => {
  const close = jest.fn();
  const { rerender } = render(
    <>
      <TileWorkspaceSurface title="Site" focusKey="site" onClose={close}>
        Site controls
      </TileWorkspaceSurface>
      <div className="MuiModal-root">Confirmation</div>
    </>,
  );
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Site" }), {
    key: "Escape",
  });
  expect(close).not.toHaveBeenCalled();
  rerender(
    <TileWorkspaceSurface title="Site" focusKey="site" onClose={close}>
      Site controls
    </TileWorkspaceSurface>,
  );
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Site" }), {
    key: "Escape",
  });
  expect(close).toHaveBeenCalledTimes(1);
});
