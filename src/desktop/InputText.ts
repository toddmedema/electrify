import type { DesktopTextInput } from "../Desktop";
import { inputScope, visibleControls } from "./InputNavigation";

type TextControl = HTMLInputElement | HTMLTextAreaElement;

/** Only fields that accept typed text belong to Steam's text editor. */
export function editableTextControl(
  element: Element | null,
): TextControl | null {
  if (
    !(
      element instanceof HTMLTextAreaElement ||
      (element instanceof HTMLInputElement &&
        [
          "text",
          "search",
          "email",
          "url",
          "tel",
          "password",
          "number",
        ].includes(element.type))
    ) ||
    element.readOnly ||
    element.disabled ||
    element.matches("[aria-disabled=true]") ||
    element.maxLength === 0
  )
    return null;
  return element;
}

export function availableTextControl(
  target: Element | null,
): TextControl | null {
  const element = editableTextControl(target);
  if (!element) return null;
  const scope = inputScope();
  // Autocomplete can portal its listbox while the text field keeps focus.
  const owned = `${element.getAttribute("aria-controls") ?? ""} ${element.getAttribute("aria-owns") ?? ""}`;
  return visibleControls(element).includes(element) &&
    (scope.contains(element) ||
      (scope.id && owned.split(/\s+/).includes(scope.id)))
    ? element
    : null;
}

export function focusedTextControl(): TextControl | null {
  return availableTextControl(document.activeElement);
}

/** A navigated autocomplete option belongs to Confirm rather than to text entry. */
export function highlightedTextOption(element: TextControl): boolean {
  if (!element.matches('[role="combobox"][aria-expanded="true"]')) return false;
  const option = document.getElementById(
    element.getAttribute("aria-activedescendant") ?? "",
  );
  const listbox = option?.closest('[role="listbox"]');
  const owned = `${element.getAttribute("aria-controls") ?? ""} ${element.getAttribute("aria-owns") ?? ""}`;
  return !!(
    option?.matches('[role="option"]:not([aria-disabled="true"])') &&
    listbox?.id &&
    owned.split(/\s+/).includes(listbox.id)
  );
}

export function textInputRequest(element: TextControl): DesktopTextInput {
  const labelledBy = (element.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
  const description =
    element.getAttribute("aria-label") ||
    labelledBy ||
    Array.from(element.labels ?? [])
      .map((label) => label.textContent)
      .join(" ") ||
    element.placeholder ||
    "Enter text";
  const maxLength = Math.min(
    2048,
    element.maxLength < 0 ? 2048 : element.maxLength,
  );
  return {
    description: description.trim().slice(0, 256) || "Enter text",
    text: element.value.slice(0, maxLength),
    maxLength,
    multiline: element instanceof HTMLTextAreaElement,
    password:
      element instanceof HTMLInputElement && element.type === "password",
  };
}

export function applyTextInput(element: TextControl, text: string): void {
  if (
    element instanceof HTMLInputElement &&
    element.type === "number" &&
    text !== ""
  ) {
    const candidate = document.createElement("input");
    candidate.type = "number";
    candidate.value = text;
    if (!candidate.value) return;
  }
  const maxLength = textInputRequest(element).maxLength;
  // Match maxlength's UTF-16 units without splitting a Unicode surrogate pair.
  let value = "";
  for (const character of text) {
    if (value.length + character.length > maxLength) break;
    value += character;
  }
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;
  // Bypass React's value tracker, as the normal native input event does.
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
    element,
    value,
  );
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}
