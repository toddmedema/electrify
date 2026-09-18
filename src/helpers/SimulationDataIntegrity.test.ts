import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import manifest from "../data/RunCompatibility.json";
import { simulationDataRequest } from "./SimulationDataIntegrity";
import { fetchCsv } from "./Csv";

it("pins every shipped data response to its actual bytes", () => {
  for (const [url, integrity] of Object.entries(manifest.dataIntegrity)) {
    const bytes = readFileSync(path.join(process.cwd(), "public", url));
    const actual = `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
    expect(integrity).toBe(actual);
    expect(simulationDataRequest(url)).toEqual({ integrity: actual });
  }
  expect(simulationDataRequest("/data/weather/custom-place.bin")).toEqual({});
});

it("passes integrity to the CSV request and propagates rejected response bytes", async () => {
  const originalFetch = global.fetch;
  const request = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  global.fetch = request;
  try {
    await expect(fetchCsv("/data/EconomyRaw.csv")).rejects.toThrow(
      "Failed to fetch",
    );
    expect(request).toHaveBeenCalledWith("/data/EconomyRaw.csv", {
      integrity: manifest.dataIntegrity["/data/EconomyRaw.csv"],
    });
  } finally {
    global.fetch = originalFetch;
  }
});
