import { fireEvent, render, screen } from "@testing-library/react";
import { listenForShortcuts } from "./GlobalShortcuts";

const keyMap = {
  pause: ["`", "space", "0"],
  slow: "1",
  build: "q",
  earlier: "[",
  help: ["?", "shift+/"],
  escape: "esc",
  facility: "shift+1",
};
let handlers: Record<keyof typeof keyMap, jest.Mock>;
let stop: () => void;

beforeEach(() => {
  handlers = {
    pause: jest.fn(),
    slow: jest.fn(),
    build: jest.fn(),
    earlier: jest.fn(),
    help: jest.fn(),
    escape: jest.fn(),
    facility: jest.fn(),
  };
  stop = listenForShortcuts(keyMap, handlers);
});
afterEach(() => stop());

it.each([
  ["`", "pause"],
  [" ", "pause"],
  ["0", "pause"],
  ["1", "slow"],
  ["q", "build"],
  ["Q", "build"],
  ["[", "earlier"],
  ["?", "help"],
  ["Escape", "escape"],
] as const)("dispatches %s to %s", (key, action) => {
  fireEvent.keyDown(document.body, { key });
  expect(handlers[action]).toHaveBeenCalledTimes(1);
  expect(handlers[action]).toHaveBeenCalledWith(expect.any(KeyboardEvent));
});

it("recognizes shifted punctuation and digits without triggering bare number actions", () => {
  fireEvent.keyDown(document.body, { key: "?", code: "Slash", shiftKey: true });
  fireEvent.keyDown(document.body, { key: "/", shiftKey: true });
  fireEvent.keyDown(document.body, {
    key: "!",
    code: "Digit1",
    shiftKey: true,
  });
  // On layouts where Shift produces the digit itself, key takes precedence over physical code.
  fireEvent.keyDown(document.body, {
    key: "1",
    code: "Numpad1",
    shiftKey: true,
  });
  expect(handlers.help).toHaveBeenCalledTimes(2);
  expect(handlers.facility).toHaveBeenCalledTimes(2);
  expect(handlers.slow).not.toHaveBeenCalled();
});

it.each(["ctrlKey", "metaKey", "altKey", "shiftKey", "repeat", "isComposing"])(
  "leaves %s key events alone",
  (flag) => {
    fireEvent.keyDown(document.body, { key: "q", [flag]: true });
    expect(handlers.build).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "q" });
    expect(handlers.build).toHaveBeenCalledTimes(1);
  },
);

it("keeps typing in text fields, but allows Escape and shortcuts from a range slider", () => {
  render(
    <>
      <input aria-label="Name" />
      <textarea aria-label="Notes" />
      <select aria-label="Option">
        <option>A</option>
      </select>
      <input type="range" aria-label="Capacity" />
    </>,
  );
  for (const label of ["Name", "Notes", "Option"]) {
    fireEvent.keyDown(screen.getByLabelText(label), { key: "q" });
    fireEvent.keyDown(screen.getByLabelText(label), {
      key: "?",
      shiftKey: true,
    });
  }
  expect(handlers.build).not.toHaveBeenCalled();
  expect(handlers.help).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" });
  expect(handlers.escape).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(screen.getByLabelText("Capacity"), { key: "q" });
  expect(handlers.build).toHaveBeenCalledTimes(1);
});

it("lets local controls consume Space and Escape", () => {
  render(
    <>
      <button>Open</button>
      <div role="button" tabIndex={0}>
        Action
      </div>
      <input type="range" aria-label="Capacity" />
      <div onKeyDown={(event) => event.preventDefault()}>Local Escape</div>
      <div onKeyDown={(event) => event.stopPropagation()}>Stopped Escape</div>
    </>,
  );
  for (const label of ["Open", "Action"])
    fireEvent.keyDown(screen.getByRole("button", { name: label }), {
      key: " ",
    });
  fireEvent.keyDown(screen.getByLabelText("Capacity"), { key: " " });
  fireEvent.keyDown(screen.getByText("Local Escape"), { key: "Escape" });
  fireEvent.keyDown(screen.getByText("Stopped Escape"), { key: "Escape" });
  expect(handlers.pause).not.toHaveBeenCalled();
  expect(handlers.escape).not.toHaveBeenCalled();
  fireEvent.keyDown(document.body, { key: " " });
  expect(handlers.pause).toHaveBeenCalledTimes(1);
});

it.each([
  { className: "MuiModal-root" },
  { "data-data-center-guide": "true" },
  { "data-scenario-choice": "true" },
  { "data-manual-help": "true" },
])("blocks global shortcuts while an overlay is present: %j", (props) => {
  const view = render(<div {...props}>Overlay</div>);
  fireEvent.keyDown(document.body, { key: "q" });
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(handlers.build).not.toHaveBeenCalled();
  expect(handlers.escape).not.toHaveBeenCalled();
  view.unmount();
  fireEvent.keyDown(document.body, { key: "q" });
  expect(handlers.build).toHaveBeenCalledTimes(1);
});

it("blocks program decision inputs and releases the listener on unmount", () => {
  render(
    <div data-program-decision="true">
      <button>Decide</button>
    </div>,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "Decide" }), {
    key: "q",
  });
  expect(handlers.build).not.toHaveBeenCalled();
  stop();
  fireEvent.keyDown(document.body, { key: "q" });
  expect(handlers.build).not.toHaveBeenCalled();
});
