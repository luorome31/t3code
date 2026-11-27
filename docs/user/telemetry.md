# Product usage data

Product usage analytics and official relay connection diagnostics are off by default in this fork.
T3 Connect sign-in, pairing, and remote access do not require either one.

To opt in on a host, set `T3CODE_TELEMETRY_ENABLED=true` in the server's environment before
launch. For desktop, use the login shell profile on macOS or Linux, or a user environment variable on
Windows, then fully restart the app. `DO_NOT_TRACK=1` and [managed policy](./managed-policy.md#other-capabilities)
can keep both off even when explicitly enabled. The OpenTelemetry SDK disable flags also stop relay
tracing. If a Windows desktop starts its WSL backend before this environment is known, analytics
and relay tracing stay off for that backend run.

When opted in, the server sends product events to `ingest.t3.codes`, which stores and forwards
usage data to PostHog. Events use a hashed random installation ID, not a provider login, T3 Connect
account, or device identifier. Events can include the provider, public model label, reasoning effort,
permission mode, results, duration, release channel, and token counts. They do not include prompts,
responses, file contents, or authentication tokens.

## Relay connection diagnostics

Connection diagnostics can send timings and error types to Axiom when a build has an exporter
configured and telemetry is explicitly enabled. The fork's release builds do not bundle this
exporter configuration. A browser using the app served by a host requires that host to explicitly
allow exports; an older server that does not advertise a decision does not enable them. The official
hosted app at `app.t3.codes` is distributed separately and is not controlled by this fork.

## Official mobile app diagnostics

The official app manages its own diagnostics separately from the desktop host. In a current build,
open **Settings > About T3 Code > Diagnostics** and turn off **Send crash reports** and
**Send connection traces**. If you see only the first switch, update the phone app. Turning off
both switches does not sign the phone out or stop it from connecting to a host.

## Agent activity for mobile notifications

When **Publish agent activity** is enabled on a host, it sends project and thread titles, model
names, activity status, and environment and thread identifiers to the T3 Connect relay for
[mobile notifications and live activities](./mobile-notifications.md). This is separate from
product events and relay diagnostics. The telemetry opt-out does not disable it.

The fork leaves publishing unchecked when setting up a new link on desktop; an existing host keeps
its choice. To stop publishing, turn off **Publish agent activity** under **Settings > Sharing & access** on
the host. Turning off notifications on a phone controls that phone's alerts, not the host's
publishing setting.

## Export diagnostics to your own receiver

To send traces, metrics, or logs to an OpenTelemetry receiver, open
**Settings > Maintenance > Diagnostics**, select an environment, and enter each signal's OTLP HTTP
endpoint under **OpenTelemetry export** (for example `http://localhost:4318/v1/traces`). Save, then
restart that environment's server. The receiver must be reachable from the server's machine.
**Test** sends an empty export from the server to check an endpoint before or after you save it;
saved endpoints are checked when the section opens. Checks send authentication headers only to
the signal's currently running endpoint and do not follow redirects. To check a new endpoint
that requires authentication, save it and restart the server first.

`T3CODE_OTLP_*_URL` and standard `OTEL_EXPORTER_OTLP_*` environment variables override the saved
settings. An overridden signal shows **Set by environment** and names the variable that set it, and its
**Test** checks the running endpoint instead of the field. For endpoints saved here or set with `T3CODE_OTLP_*_URL`, set `T3CODE_OTLP_HEADERS` for
receivers that need authentication and `T3CODE_OTLP_PROTOCOL=http/protobuf` for receivers that do
not accept JSON. An endpoint set with `OTEL_EXPORTER_OTLP_*` takes its headers and protocol from
`OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_EXPORTER_OTLP_PROTOCOL` instead.
