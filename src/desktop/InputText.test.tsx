import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  applyTextInput,
  editableTextControl,
  textInputRequest,
} from "./InputText";

it("retains multiline React changes and respects field length without splitting Unicode", () => {
  function Notes() {
    const [notes, setNotes] = useState("");
    return (
      <label>
        Campaign notes
        <textarea
          maxLength={4}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
    );
  }
  render(<Notes />);
  const field = screen.getByRole("textbox") as HTMLTextAreaElement;
  expect(textInputRequest(field)).toEqual({
    description: "Campaign notes",
    text: "",
    maxLength: 4,
    multiline: true,
    password: false,
  });
  // Dispatch the actual native edit and force a subsequent React update.
  act(() => applyTextInput(field, "a\n😀x"));
  expect(field).toHaveValue("a\n😀");
  fireEvent.change(field, { target: { value: "Next" } });
  expect(field).toHaveValue("Next");
});

it("uses native numeric validation and leaves sliders, checkboxes and readonly fields untouched", () => {
  render(
    <>
      <label>
        Price
        <input type="number" defaultValue="12" />
      </label>
      <input type="range" aria-label="Rate" />
      <input type="checkbox" aria-label="Enabled" />
      <input readOnly aria-label="Lobby code" value="123" />
    </>,
  );
  const number = screen.getByRole("spinbutton") as HTMLInputElement;
  for (const invalid of ["bad", "0xff", " 2 ", "Infinity"])
    applyTextInput(number, invalid);
  expect(number).toHaveValue(12);
  applyTextInput(number, "15.5");
  expect(number).toHaveValue(15.5);
  const range = screen.getByRole("slider");
  const checkbox = screen.getByRole("checkbox");
  const readonly = screen.getByRole("textbox");
  expect(editableTextControl(range)).toBeNull();
  expect(editableTextControl(checkbox)).toBeNull();
  expect(editableTextControl(readonly)).toBeNull();
});
