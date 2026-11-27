import { describe, expect, it } from "vite-plus/test";

import { hashTelemetryId } from "./telemetryId.ts";

describe("telemetry ids", () => {
  it("preserves the lowercase hex SHA-256 format used by ingest", () => {
    expect(hashTelemetryId("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
