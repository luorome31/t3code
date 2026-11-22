import { useMemo, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGT } from "gt-react-native";
import {
  displayTimeZoneOptions,
  SYSTEM_DISPLAY_TIME_ZONE,
} from "@t3tools/client-runtime/display-timezone";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { ListChoiceRow as SettingsChoiceRow } from "../../components/ui/ListChoiceRow";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsScreen } from "./components/SettingsScreen";

/** The label the picker row shows for the stored choice. */
export function displayTimezoneChoiceLabel(
  timeZone: string | undefined,
  systemLabel: string,
): string {
  return !timeZone || timeZone === SYSTEM_DISPLAY_TIME_ZONE ? systemLabel : timeZone;
}

export function SettingsDisplayTimezoneRouteScreen() {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const preferencesReady = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const selected = preferencesReady
    ? preferencesResult.value.displayTimezone || SYSTEM_DISPLAY_TIME_ZONE
    : null;
  const options = useMemo(
    () => [
      { id: SYSTEM_DISPLAY_TIME_ZONE, label: gt("Follow system") },
      ...displayTimeZoneOptions().map((zone) => ({ id: zone, label: zone })),
    ],
    [gt],
  );
  const needle = query.trim().toLowerCase();
  const visibleOptions = needle
    ? options.filter((option) => option.label.toLowerCase().includes(needle))
    : options;

  return (
    <SettingsScreen
      title={gt("Time zone")}
      search={{
        value: query,
        onChangeText: setQuery,
        placeholder: gt("Search time zones"),
      }}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-3 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <SettingsSection>
          {visibleOptions.map((option, index) => (
            <SettingsChoiceRow
              key={option.id}
              label={option.label}
              selected={preferencesReady && selected === option.id}
              separated={index > 0}
              disabled={!preferencesReady}
              onPress={() => {
                void savePreferences({ displayTimezone: option.id });
              }}
            />
          ))}
        </SettingsSection>
      </ScrollView>
    </SettingsScreen>
  );
}
