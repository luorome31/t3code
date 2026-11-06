import type { ResponseMetrics } from "@t3tools/client-runtime/response-metrics";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { InfoIcon } from "lucide-react";

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const tokens = new Intl.NumberFormat();

function latencyLabel(ms: number) {
  return ms < 1000 ? `${number.format(ms)}ms` : `${number.format(ms / 1000)}s`;
}

export function ResponseMetricsRow({ metrics }: { metrics: ResponseMetrics }) {
  const labels = [
    ...(metrics.firstOutputLatencyMs === undefined
      ? []
      : [`First output ${latencyLabel(metrics.firstOutputLatencyMs)}`]),
    ...(metrics.estimatedTps === undefined
      ? []
      : [
          `≈${metrics.estimatedTps > 0 && metrics.estimatedTps < 0.1 ? "<0.1" : number.format(metrics.estimatedTps)} tok/s`,
        ]),
    ...(metrics.outputTokens === undefined
      ? []
      : [
          `${metrics.outputTokensEstimated ? "≈" : ""}${tokens.format(metrics.outputTokens)} output tokens${metrics.partial ? " (partial)" : ""}`,
        ]),
  ];
  return (
    <div
      className="flex min-w-0 items-start gap-1 px-1 pb-1 text-xs text-muted-foreground tabular-nums"
      data-response-metrics={metrics.runId}
    >
      <span className="min-w-0 pt-1">
        {labels.length > 0 ? labels.join(" · ") : "Statistics unavailable"}
      </span>
      <Popover>
        <PopoverTrigger
          render={
            <Button variant="ghost" size="icon-xs" aria-label="Response performance statistics" />
          }
        >
          <InfoIcon />
        </PopoverTrigger>
        <PopoverPopup width="md" align="start" touchBackdrop>
          <div className="space-y-3 text-xs leading-relaxed">
            <PopoverTitle>Response performance</PopoverTitle>
            <p>Provider: {metrics.provider}</p>
            <p>
              Requested:{" "}
              {metrics.requested
                .map(
                  (selection) =>
                    `${selection.model}${selection.options ? ` (${selection.options.map(({ id, value }) => `${id}: ${value}`).join(", ")})` : ""}`,
                )
                .join(", ")}
            </p>
            <p>
              Reported models:{" "}
              {metrics.reportedModels.length > 0
                ? metrics.reportedModels.join(", ")
                : "Not reported"}
            </p>
            <p>
              First output (TTFT): server-observed time from starting provider execution to the
              first non-empty main-agent text or reasoning. Tools and status messages do not end
              this interval. Client transport and rendering are excluded.
            </p>
            {metrics.firstOutputLatencyMs === undefined ? null : (
              <p>
                {metrics.firstOutputLatencyMs} ms (
                {new Date(metrics.executionStartedAtMs!).toISOString()} →{" "}
                {new Date(metrics.firstOutputObservedAtMs!).toISOString()}).
              </p>
            )}
            <p>
              Estimated TPS divides reported or estimated output tokens by the sum of
              server-observed streaming output windows. Tool and approval boundaries split the
              windows, excluding their wait before text resumes. Startup and waiting before the
              first output are excluded. Network jitter and buffering still affect this estimate;
              unobserved hidden reasoning can make it too high.
            </p>
            {metrics.estimatedTps === undefined ? null : (
              <p>
                {metrics.outputTokensEstimated ? "≈" : ""}
                {tokens.format(metrics.outputTokens!)} output tokens ÷ (
                {metrics.observedOutputDurationMs} ms / 1,000). Timing source: server observations,
                version 1.
              </p>
            )}
            <p>
              {metrics.outputTokensEstimated
                ? "Where the provider did not report output usage, visible main-agent text and reasoning are estimated at four ASCII characters or one non-ASCII code point per token. Hidden reasoning and tool arguments cannot be estimated. Reported usage takes precedence when it arrives."
                : "Tokens use provider-reported main-agent usage, including reported reasoning as a subset."}{" "}
              Native subagents and other usage are excluded. Usage:{" "}
              {metrics.outputTokens === undefined
                ? "unavailable"
                : metrics.outputTokensEstimated
                  ? metrics.partial
                    ? "estimated, partial"
                    : "estimated"
                  : metrics.partial
                    ? "partial"
                    : "complete"}
              .
            </p>
            {metrics.missing.length > 0 ? (
              <ul className="list-disc space-y-1 pl-4">
                {metrics.missing.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </PopoverPopup>
      </Popover>
    </div>
  );
}
