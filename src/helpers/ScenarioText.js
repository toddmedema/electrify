/* Plain date substitutions only: no evaluation, property access or executable templates. */
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const TOKEN = /\{\{\s*(start|event)\s*(?:\+\s*(\d+)\s+months?\s*)?\}\}/g;
function scenarioTextError(text, allowEvent = false) {
  if (typeof text !== "string") return;
  let error;
  const rest = text.replace(TOKEN, (_, anchor, offset = "0") => {
    if (anchor === "event" && !allowEvent)
      error = "event dates are only available in event and choice text.";
    else if (Number(offset) > 1200)
      error = "date offsets must be between 0 and 1200 months.";
    return "";
  });
  if (rest.includes("{{") || rest.includes("}}"))
    error = "use {{start+2 months}} or {{event+7 months}} for dates.";
  return error;
}
function renderScenarioText(text, startingYear, eventMonth) {
  return text.replace(TOKEN, (token, anchor, offset = "0") => {
    if (anchor === "event" && eventMonth === undefined) return token;
    const months = (anchor === "event" ? eventMonth : 0) + Number(offset);
    if (months > 2400) return token;
    return dateFormatter.format(new Date(Date.UTC(startingYear, months, 1)));
  });
}
function scenarioTextLength(text, allowEvent = false) {
  return Math.max(
    text.length,
    ...Array.from(
      { length: allowEvent ? 12 : 1 },
      (_, month) =>
        renderScenarioText(text, 2000, allowEvent ? month : undefined).length,
    ),
  );
}
module.exports = { scenarioTextError, renderScenarioText, scenarioTextLength };
