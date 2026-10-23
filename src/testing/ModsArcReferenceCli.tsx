/** Invoked by scripts/mods-arcs.js, not ordinary Jest discovery. */
import fs from "fs";
import { formatModArcReference, modArcReferences } from "./ModArcReference";

it("generates the imported arc reference from production compilation", () => {
  fs.writeFileSync(
    process.env.MODS_ARCS_RESULT!,
    formatModArcReference(modArcReferences()),
  );
});
