export const SYSTEM_DISPLAY_TIME_ZONE = "system";

function isSupportedTimeZone(timeZone: string): boolean {
  if (!timeZone.trim()) return false;
  try {
    // Called without `new`, the constructor still validates the zone name.
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The IANA zone absolute times render in, or undefined to keep the device's zone: the
 * toggle is off, the choice follows the system, or the saved name is no longer valid.
 */
export function resolveDisplayTimeZone(
  enabled: boolean | undefined,
  timeZone: string | undefined,
): string | undefined {
  if (!enabled || !timeZone || timeZone === SYSTEM_DISPLAY_TIME_ZONE) return undefined;
  return isSupportedTimeZone(timeZone) ? timeZone : undefined;
}

/** Runtimes without `Intl.supportedValuesOf` still offer these zones in the picker. */
const FALLBACK_TIME_ZONES = [
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/Mexico_City",
  "America/New_York",
  "America/Toronto",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "Europe/London",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Brussels",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Zurich",
  "Europe/Rome",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "Europe/Athens",
  "Europe/Helsinki",
  "Europe/Kyiv",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Africa/Cairo",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Africa/Nairobi",
  "Asia/Dubai",
  "Asia/Tehran",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Singapore",
  "Asia/Manila",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Perth",
  "Australia/Brisbane",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
] as const;

/** The IANA zone names a picker offers. `Intl` never enumerates UTC, so it is added by hand. */
export function displayTimeZoneOptions(): readonly string[] {
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    if (zones.length > 0) return zones.includes("UTC") ? zones : [...zones, "UTC"];
  } catch {
    // Older runtimes cannot enumerate zones; offer the curated list.
  }
  return FALLBACK_TIME_ZONES;
}
