const fs = require("node:fs");
const path = require("node:path");

// This is inspection of recorded evidence, not a cache/reuse or process-liveness check.
function validationStatus(steps, explicitPath, root = process.cwd()) {
  const inspectedAt = new Date().toISOString();
  let reportPath = explicitPath ? path.resolve(root, explicitPath) : null;
  const base = {
    schemaVersion: 1,
    historical: true,
    inspectedAt,
    currentValidation: "not-checked",
    reuseEligibility: "not-checked",
    activity: { queued: "unknown", ownerAlive: "unknown" },
  };
  try {
    if (!reportPath) {
      const parent = path.join(root, ".tmp", "check-runs");
      // Run names begin with their creation timestamp. Never skip a broken newest run.
      const latest = fs
        .readdirSync(parent, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map(({ name }) => name)
        .sort()
        .pop();
      if (!latest) throw new Error("No recorded validation run");
      const directory = path.join(parent, latest);
      reportPath = path.join(directory, "report.json");
      if (fs.lstatSync(directory).isSymbolicLink())
        throw new Error("Latest run directory is a symbolic link");
    }
    const limit = 1024 * 1024;
    if (!fs.lstatSync(reportPath).isFile())
      throw new Error("Report must be a regular file of at most 1 MiB");
    // One bounded read: older writers may leave partial JSON, which is unavailable evidence.
    const file = fs.openSync(reportPath, "r");
    let report;
    try {
      if (!fs.fstatSync(file).isFile())
        throw new Error("Report must be a regular file");
      const bytes = Buffer.alloc(limit + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = fs.readSync(file, bytes, length, bytes.length - length);
        if (!read) break;
        length += read;
      }
      if (length > limit) throw new Error("Report exceeds 1 MiB");
      report = JSON.parse(bytes.toString("utf8", 0, length));
    } finally {
      fs.closeSync(file);
    }
    const ids = steps.map(({ id }) => id);
    const selected = report?.scope?.selected;
    const gates = report?.gates;
    const uniqueIds = (values) =>
      Array.isArray(values) &&
      values.length > 0 &&
      new Set(values).size === values.length &&
      values.every((id) => ids.includes(id));
    const validDate = (value) =>
      typeof value === "string" && Number.isFinite(Date.parse(value));
    const terminal = ["passed", "failed", "skipped"];
    if (
      report?.schemaVersion !== 1 ||
      !["running", "passed", "failed", "invalidated"].includes(report.status) ||
      !validDate(report.startedAt) ||
      !uniqueIds(selected) ||
      !Array.isArray(gates) ||
      !uniqueIds(gates.map((gate) => gate?.id)) ||
      gates.length !== selected.length ||
      gates.some(
        (gate) =>
          !selected.includes(gate.id) ||
          !["pending", "running", ...terminal].includes(gate.status) ||
          (gate.execution != null &&
            !["executed", "reused"].includes(gate.execution)) ||
          (gate.execution === "reused" && gate.status !== "passed") ||
          (gate.status === "passed" &&
            (gate.execution == null ||
              gate.ok === false ||
              gate.exitCode !== 0 ||
              gate.reportErrors?.length)),
      )
    )
      throw new Error("Incomplete or unsupported validation report");
    const ci = selected.some((id) => steps.find((step) => step.id === id).ci);
    const full = steps
      .filter((step) => ci || !step.ci)
      .every((step) => selected.includes(step.id));
    if (
      report.scope.profile !== (ci ? "ci" : "quick") ||
      report.scope.full !== full ||
      [report.scope.ciOnly, report.scope.separateChecks].some(
        (values) =>
          values != null &&
          (!Array.isArray(values) ||
            values.some((value) => typeof value !== "string")),
      )
    )
      throw new Error("Validation scope does not match the recorded gates");
    const completed = report.status !== "running";
    if (
      (completed &&
        (!validDate(report.finishedAt) ||
          Date.parse(report.finishedAt) < Date.parse(report.startedAt) ||
          gates.some((gate) => !terminal.includes(gate.status)))) ||
      (!completed && report.finishedAt != null) ||
      (report.status === "passed" &&
        (gates.some((gate) => gate.status !== "passed") ||
          report.source?.changedDuringRun !== false)) ||
      (report.status === "failed" &&
        !gates.some((gate) => ["failed", "skipped"].includes(gate.status))) ||
      (report.status === "invalidated" &&
        report.source?.changedDuringRun !== true)
    )
      throw new Error("Inconsistent or incomplete validation result");

    const directory = path.dirname(reportPath);
    const evidenceFile = (relative) => {
      if (relative == null) return null;
      // Do not expose paths outside this run, including Windows paths or symlink escapes.
      if (
        typeof relative !== "string" ||
        path.posix.isAbsolute(relative) ||
        path.win32.isAbsolute(relative) ||
        relative
          .split(/[\\/]/)
          .some(
            (part) => !part || /^(\.|\.\.)$/.test(part) || part.includes(":"),
          )
      )
        return { path: null, available: false };
      let target = directory;
      try {
        for (const part of relative.split(/[\\/]/)) {
          target = path.join(target, part);
          if (fs.lstatSync(target).isSymbolicLink())
            return { path: null, available: false };
        }
        return { path: target, available: fs.statSync(target).isFile() };
      } catch {
        return { path: path.resolve(directory, relative), available: false };
      }
    };
    const counts = Object.fromEntries(
      ["pending", "running", ...terminal].map((status) => [
        status,
        gates.filter((gate) => gate.status === status).length,
      ]),
    );
    const retryIds = steps
      .filter((step) =>
        gates.some(
          (gate) =>
            gate.id === step.id && ["failed", "skipped"].includes(gate.status),
        ),
      )
      .map(({ id }) => id);
    const nonnegative = (value) =>
      Number.isFinite(value) && value >= 0 ? value : null;
    return {
      ...base,
      availability: "available",
      reportPath,
      recordedStatus: report.status,
      completed,
      scope: {
        profile: ci ? "ci" : "quick",
        full,
        selected,
        notSelected: ids.filter((id) => !selected.includes(id)),
        ciOnly: report.scope.ciOnly || [],
        separateChecks: report.scope.separateChecks || [],
      },
      counts: {
        ...counts,
        total: gates.length,
        executed: gates.filter((gate) => gate.execution === "executed").length,
        reused: gates.filter((gate) => gate.execution === "reused").length,
      },
      timing: {
        startedAt: report.startedAt,
        finishedAt: report.finishedAt || null,
        ageMs: Math.max(
          0,
          Date.parse(inspectedAt) -
            Date.parse(report.finishedAt || report.startedAt),
        ),
        elapsedMs: completed
          ? nonnegative(report.timing?.executionMs)
          : Math.max(0, Date.parse(inspectedAt) - Date.parse(report.startedAt)),
        queueMs: nonnegative(report.timing?.queueMs),
      },
      provenance: {
        source: report.source || null,
        environment: report.environment || null,
        evidenceContents: "not-checked",
      },
      gates: steps
        .filter((step) => selected.includes(step.id))
        .map((step) => {
          const gate = gates.find(({ id }) => id === step.id);
          return {
            id: step.id,
            name: step.name,
            status: gate.status,
            execution: gate.execution || null,
            seconds: nonnegative(gate.seconds),
            exitCode: Number.isInteger(gate.exitCode) ? gate.exitCode : null,
            reason: gate.reason || null,
            reportErrors: Array.isArray(gate.reportErrors)
              ? gate.reportErrors
              : [],
            log: evidenceFile(gate.log),
            reports: Array.isArray(gate.reports)
              ? gate.reports.map(evidenceFile)
              : [],
            reusedFrom: gate.reusedFrom || null,
            rerun: ["failed", "skipped"].includes(gate.status)
              ? `npm run check -- --steps ${step.id}`
              : null,
          };
        }),
      rerun: {
        failed: retryIds.length
          ? `npm run check -- --steps ${retryIds.join(",")}`
          : null,
        integrated: `npm run check${ci ? ":ci" : ""} -- --resume`,
      },
    };
  } catch (error) {
    return {
      ...base,
      availability: "unavailable",
      reportPath,
      reason:
        error.code === "ENOENT"
          ? "No report at the selected run/path"
          : error.message,
    };
  }
}

function formatStatus(status) {
  const lines = [
    "Historical validation only; current source, environment, artifacts and reuse eligibility unchecked.",
    "Queued activity and owner liveness: unknown.",
    `Report: ${status.reportPath || "none"}`,
  ];
  if (status.availability !== "available")
    return [...lines, `Recorded evidence unavailable: ${status.reason}.`].join(
      "\n",
    );
  const { counts, scope, timing } = status;
  const seconds = (ms) =>
    ms == null ? "unknown" : `${(ms / 1000).toFixed(1)}s`;
  lines.push(
    `Recorded result: ${status.recordedStatus}; ${scope.full ? "full" : "partial"} ${scope.profile} profile; ${counts.passed}/${counts.total} gates passed.`,
    `Gates: ${Object.entries(counts)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ")}.`,
    `Started: ${timing.startedAt}; finished: ${timing.finishedAt || "not recorded"}; age: ${seconds(timing.ageMs)}; elapsed: ${seconds(timing.elapsedMs)}; queue: ${seconds(timing.queueMs)}.`,
    `Recorded source: ${status.provenance.source?.after?.commit || status.provenance.source?.before?.commit || "unavailable"}; fingerprint: ${status.provenance.source?.after?.fingerprint || status.provenance.source?.before?.fingerprint || "unavailable"}.`,
    `Recorded runtime: ${status.provenance.environment?.node || "unknown"}, ${status.provenance.environment?.platform || "unknown"}/${status.provenance.environment?.arch || "unknown"}; Jest workers: ${status.provenance.environment?.jestWorkers ?? "unknown"}. Evidence contents unchecked.`,
    `Selected: ${scope.selected.join(", ")}. Outside scope: ${[...scope.notSelected, ...scope.ciOnly, ...scope.separateChecks].join(", ") || "none"}.`,
    ...status.gates.map(
      (gate) =>
        `${gate.id}: ${gate.status}${gate.execution ? ` (${gate.execution})` : ""}${gate.exitCode != null ? `; exit ${gate.exitCode}` : ""}${gate.reason ? `; ${gate.reason}` : ""}${gate.reportErrors.length ? `; ${gate.reportErrors.join("; ")}` : ""}; log: ${gate.log?.available ? gate.log.path : "unavailable"}${gate.reusedFrom ? `; reused from ${gate.reusedFrom.report}` : ""}${gate.reports.length ? `; reports: ${gate.reports.map((file) => (file?.available ? file.path : "unavailable")).join(", ")}` : ""}`,
    ),
  );
  if (status.rerun.failed)
    lines.push(`Failed-gate retry: ${status.rerun.failed}`);
  lines.push(
    `Integrated check with verified reuse: ${status.rerun.integrated}`,
  );
  return lines.join("\n");
}

module.exports = { validationStatus, formatStatus };
