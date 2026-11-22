import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";

import { resolveDisplayTimeZone } from "@t3tools/client-runtime/display-timezone";

import { mobilePreferencesAtom } from "./preferences";

/** The IANA zone absolute times render in; undefined keeps this device's zone. */
export function useDisplayTimeZone(): string | undefined {
  const preferences = useAtomValue(mobilePreferencesAtom);
  if (!AsyncResult.isSuccess(preferences)) return undefined;
  return resolveDisplayTimeZone(
    preferences.value.displayTimezoneEnabled,
    preferences.value.displayTimezone,
  );
}
