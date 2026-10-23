const { renderScenarioText } = require("../helpers/ScenarioText");
const {
  UNSAFE_TEXT,
  UNSAFE_MARKUP,
} = require("../helpers/ScenarioRulesSchema");
const { utf8Bytes } = require("../helpers/RuleIdentity");
// Steam's k_cchPublishedDocumentDescriptionMax is 8000 bytes including the C terminator.
// https://partner.steamgames.com/doc/api/ISteamRemoteStorage#constants
const MAX_WORKSHOP_DESCRIPTION_BYTES = 7999;
function validatePublicationDescription(description, pack) {
  // Main has no catalog import. A base's year is resolved in the renderer; accept only
  // safe date expansions of the author's own text, never an edited description.
  const years =
    pack.scenario?.startingYear !== undefined
      ? [pack.scenario.startingYear]
      : pack.baseScenarioId !== undefined && pack.baseScenarioId !== 999
        ? Array.from({ length: 121 }, (_, i) => 1980 + i)
        : [2020];
  if (
    typeof description !== "string" ||
    !years.some((year) =>
      description.startsWith(
        `${renderScenarioText(pack.description, year)}\n\nRules\n`,
      ),
    ) ||
    UNSAFE_TEXT.test(description.replace(/\n/g, "")) ||
    UNSAFE_MARKUP.test(description)
  )
    throw new Error(
      "Review and regenerate this package's public Rules description before publishing.",
    );
  if (utf8Bytes(description).length > MAX_WORKSHOP_DESCRIPTION_BYTES)
    throw new Error(
      "The public description and generated Rules exceed Steam's 7,999-byte description limit. Shorten the author description or announced event/decision labels, then validate again; no rules were truncated.",
    );
  return description;
}
module.exports = {
  MAX_WORKSHOP_DESCRIPTION_BYTES,
  validatePublicationDescription,
};
