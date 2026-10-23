/** Ignored by ordinary Jest discovery, like SimCli; scripts/mods-validate.js invokes it. */
import * as fs from "fs";
import { buildModAuthorReport } from "../mods/ModAuthoring";
import type { ModAuthorReport } from "../mods/ModAuthoring";
import { ModValidationError } from "../mods/ModSchema";
import { formatModAuthorReport, loadModCliData } from "./ModCli";
import { readModCliJson } from "./ModCliFiles";

jest.setTimeout(60000);

it("scenario authoring validation", () => {
  let report: ModAuthorReport;
  try {
    const input = readModCliJson(process.env.MODS_VALIDATE_INPUT!);
    try {
      loadModCliData(input);
    } catch (error) {
      // Structural diagnostics are owned by the common report and must remain aggregated.
      if (!(error instanceof ModValidationError)) throw error;
    }
    report = buildModAuthorReport(input);
  } catch (error) {
    report = {
      title: "Scenario mod",
      description: "",
      sections: [],
      valid: false,
      inheritedObjectives: [],
      difficulties: {},
      diagnostics: [
        {
          code: "authoring-input",
          path: "$",
          severity: "error",
          message:
            error instanceof Error
              ? error.message
              : "The JSON file could not be read.",
        },
      ],
    };
  }
  fs.writeFileSync(
    process.env.MODS_VALIDATE_RESULT!,
    JSON.stringify({
      report,
      text: formatModAuthorReport(
        report,
        process.env.MODS_VALIDATE_EXPLAIN === "1",
      ),
    }),
  );
});
