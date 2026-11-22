import { resolveDisplayTimeZone } from "@t3tools/client-runtime/display-timezone";

import { useClientSettings } from "./useSettings";

/** The IANA zone absolute times render in; undefined keeps this device's zone. */
export function useDisplayTimeZone(): string | undefined {
  return useClientSettings((settings) =>
    resolveDisplayTimeZone(settings.displayTimezoneEnabled, settings.displayTimezone),
  );
}
