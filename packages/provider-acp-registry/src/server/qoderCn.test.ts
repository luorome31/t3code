import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { AcpRegistrySettings } from "../settings.ts";
import {
  isQoderCn,
  parseQoderCnModelOptions,
  QODER_CN_CONTEXT_OPTION_ID,
  qoderCnRuntimeConfigurationKey,
  qoderCnSpawnArgs,
  readQoderCnModelOptions,
} from "./qoderCn.ts";

const response = (models: ReadonlyArray<unknown>) =>
  JSON.stringify({
    type: "control_response",
    response: { subtype: "success", request_id: "t3-model-options", response: { models } },
  });
const catalog = response([
  { modelId: "auto", availableContextWindows: [200_000], defaultContextWindow: 200_000 },
  {
    modelId: "qmodel",
    efforts: ["xhigh", "low", "medium"],
    supportsDisabled: true,
    defaultEffort: "medium",
    availableContextWindows: [1_000_000, 200_000, 400_000],
    defaultContextWindow: 200_000,
  },
]);
const selection = (value?: string, model = "qmodel"): ModelSelection => ({
  instanceId: ProviderInstanceId.make("qoder-cn-test"),
  model,
  ...(value === undefined ? {} : { options: [{ id: QODER_CN_CONTEXT_OPTION_ID, value }] }),
});
const spawn = { command: "qodercn", args: ["--acp", "--config-dir", "/test/config"] };
const spawner = (output = catalog, code = 0) =>
  ChildProcessSpawner.make((command) => {
    expect(ChildProcess.isStandardCommand(command)).toBe(true);
    if (ChildProcess.isStandardCommand(command)) {
      expect(command.command).toBe("qodercn");
      expect(command.args).not.toContain("--acp");
      expect(command.args.slice(0, 2)).toEqual(["--config-dir", "/test/config"]);
      expect(command.args.slice(-5)).toEqual([
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "-p",
      ]);
    }
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(900_000_102),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(code)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: Stream.make(new TextEncoder().encode(output)),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      }),
    );
  });

describe("Qoder CN model options", () => {
  it("identifies CN launchers without changing global Qoder instances", () => {
    const settings = Schema.decodeSync(AcpRegistrySettings);
    for (const commandPath of ["qodercn", "/opt/qoderclicn", "C:\\Qoder\\qoder-cn.exe"]) {
      expect(isQoderCn(settings({ source: "local", commandPath }))).toBe(true);
    }
    expect(isQoderCn(settings({ source: "local", commandPath: "qoder" }))).toBe(false);
    expect(isQoderCn(settings({ agentId: "qoder" }))).toBe(false);
  });

  it("uses model-specific catalog values and omits malformed, disabled and unrelated records", () => {
    const models = parseQoderCnModelOptions(
      `not-json\n${catalog}\n${response([
        { modelId: "disabled", isEnabled: false, efforts: ["high"] },
        { modelId: " invalid", efforts: ["high"] },
        {
          modelId: "bounded",
          availableContextWindows: [0, -1, 1.5, 200_000, 200_000],
          efforts: ["high", "high", " "],
        },
        { modelId: "malformed", availableContextWindows: "200K" },
      ])}`,
    );
    expect(Object.keys(models)).toEqual(["auto", "qmodel", "bounded"]);
    expect(models.auto?.map((option) => option.id)).toEqual([QODER_CN_CONTEXT_OPTION_ID]);
    expect(models.qmodel?.[0]).toMatchObject({
      id: "reasoning_effort",
      role: "reasoning",
      currentValue: "medium",
      options: [{ id: "xhigh" }, { id: "low" }, { id: "medium" }, { id: "none" }],
    });
    expect(models.qmodel?.[1]).toMatchObject({
      id: QODER_CN_CONTEXT_OPTION_ID,
      currentValue: "default",
      options: [
        { id: "default" },
        { id: "200000", label: "200K", isDefault: true },
        { id: "400000", label: "400K" },
        { id: "1000000", label: "1M" },
      ],
    });
    expect(models.bounded?.[1]).toMatchObject({ options: [{ id: "default" }, { id: "200000" }] });
    expect(
      parseQoderCnModelOptions(response([]).replace("t3-model-options", "another-request")),
    ).toEqual({});
  });

  it.effect(
    "translates a supported context window to CLI arguments and rejects stale selections",
    () =>
      Effect.gen(function* () {
        expect(yield* qoderCnSpawnArgs(spawn, selection())).toEqual([
          ...spawn.args,
          "--model",
          "qmodel",
          "--context-window",
          "200000",
        ]);
        expect(yield* qoderCnSpawnArgs(spawn, selection("default"))).toEqual([
          ...spawn.args,
          "--model",
          "qmodel",
          "--context-window",
          "200000",
        ]);
        expect(yield* qoderCnSpawnArgs(spawn, selection("400000"))).toEqual([
          ...spawn.args,
          "--model",
          "qmodel",
          "--context-window",
          "400000",
        ]);
        const configured = { ...spawn, args: [...spawn.args, "--context-window", "400000"] };
        expect((yield* qoderCnSpawnArgs(configured, selection())).slice(-2)).toEqual([
          "--context-window",
          "400000",
        ]);
        expect((yield* qoderCnSpawnArgs(configured, selection("default"))).slice(-2)).toEqual([
          "--context-window",
          "200000",
        ]);
        for (const pick of [
          selection("400000", "auto"),
          selection("-1"),
          selection("400000;touch /tmp/unwanted"),
        ]) {
          const result = yield* Effect.result(qoderCnSpawnArgs(spawn, pick));
          expect(result._tag).toBe("Failure");
        }
        expect(qoderCnRuntimeConfigurationKey(selection())).not.toBe(
          qoderCnRuntimeConfigurationKey(selection("default")),
        );
        expect(qoderCnRuntimeConfigurationKey(selection("400000"))).not.toBe(
          qoderCnRuntimeConfigurationKey(selection("200000")),
        );
        expect(qoderCnRuntimeConfigurationKey(selection("200000", "auto"))).not.toBe(
          qoderCnRuntimeConfigurationKey(selection("200000")),
        );
      }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner())),
  );

  it.effect("keeps ACP usable when supplemental model metadata is unavailable", () =>
    Effect.gen(function* () {
      expect(yield* readQoderCnModelOptions(spawn)).toEqual({});
      expect((yield* Effect.result(qoderCnSpawnArgs(spawn, selection("400000"))))._tag).toBe(
        "Failure",
      );
    }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner("unknown", 1))),
  );
});
