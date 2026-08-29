import {
  DISPLAY_NAME_MAX_LENGTH,
  displayNameKey,
  normalizeDisplayName,
  suggestDisplayName,
  validateDisplayName,
} from "./DisplayName";

describe("validateDisplayName", () => {
  const accepted = [
    "Ada",
    "ada-lovelace",
    "Grid_Operator 7",
    "a".repeat(DISPLAY_NAME_MAX_LENGTH),
    "  Padded  ", // trimmed rather than rejected
  ];
  it("accepts the supported name forms", () => {
    accepted.forEach((name) => {
      expect(validateDisplayName(name)).toBeUndefined();
    });
  });

  const rejected: Array<[string, RegExp]> = [
    ["", /at least 3/],
    ["ab", /at least 3/],
    ["a".repeat(DISPLAY_NAME_MAX_LENGTH + 1), /at most 20/],
    ["Ada!", /letters, numbers/],
    ["<script>x", /letters, numbers/],
    ["Ada  Lovelace", /double spaces/],
    ["Admin", /reserved/],
    ["anonymous", /reserved/],
  ];
  it("rejects each invalid name class with a useful reason", () => {
    rejected.forEach(([name, message]) => {
      expect(validateDisplayName(name)).toMatch(message);
    });
  });
});

describe("displayNameKey", () => {
  // The claim document is what makes a name unique, so two names that differ only in case or
  // padding have to land on the same key or both get claimed
  it("folds case and padding together", () => {
    expect(displayNameKey("  Ada  ")).toBe("ada");
    expect(displayNameKey("ADA")).toBe(displayNameKey("ada"));
  });
});

describe("normalizeDisplayName", () => {
  it("stores what the player meant, not their whitespace", () => {
    expect(normalizeDisplayName(" Ada Lovelace ")).toBe("Ada Lovelace");
  });
});

describe("suggestDisplayName", () => {
  it("seeds from the Google name when it is usable as-is", () => {
    expect(suggestDisplayName("Ada Lovelace")).toBe("Ada Lovelace");
  });

  // A full name is a suggestion, not a constraint - trimming one the board would reject beats
  // handing the player an empty box
  it("strips characters the board doesn't take", () => {
    expect(suggestDisplayName("Ada  Lovelace-King!")).toBe("Ada Lovelace-King");
  });

  it("truncates a name past the limit", () => {
    expect(suggestDisplayName("Bartholomew Featherstonehaugh")).toBe(
      "Bartholomew Feathers",
    );
  });

  it("gives up rather than suggesting something invalid", () => {
    expect(suggestDisplayName("...")).toBe("");
    expect(suggestDisplayName(undefined)).toBe("");
    expect(suggestDisplayName(null)).toBe("");
  });
});
