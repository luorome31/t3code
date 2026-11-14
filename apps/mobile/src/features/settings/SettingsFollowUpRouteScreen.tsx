import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { DEFAULT_SEND_SCROLL_BEHAVIOR, type SendScrollBehavior } from "@t3tools/contracts/settings";
import { DEFAULT_FOLLOW_UP_BEHAVIOR, type FollowUpBehavior } from "../../lib/followUpBehavior";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { ListChoiceRow as SettingsChoiceRow } from "../../components/ui/ListChoiceRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsScreen } from "./components/SettingsScreen";

const FOLLOW_UP_OPTIONS: ReadonlyArray<{
  readonly behavior: FollowUpBehavior;
  readonly label: string;
  readonly description: string;
}> = [
  {
    behavior: "queue",
    label: "Queue",
    description: "Your message waits and runs after the current turn finishes.",
  },
  {
    behavior: "steer",
    label: "Steer",
    description: "Your message reaches the agent right away, changing what it is working on.",
  },
];

const SEND_SCROLL_OPTIONS: ReadonlyArray<{
  readonly behavior: SendScrollBehavior;
  readonly label: string;
  readonly description: string;
}> = [
  {
    behavior: "always",
    label: "Always jump",
    description: "Sending moves the timeline to your message, even while you read history.",
  },
  {
    behavior: "at-end",
    label: "Only at the end",
    description: "Sending moves the timeline only when it is already at the end.",
  },
  {
    behavior: "never",
    label: "Never jump",
    description: "Sending keeps your place. Use Scroll to end to return to the live end.",
  },
];

export function SettingsFollowUpRouteScreen() {
  const insets = useSafeAreaInsets();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const preferencesReady = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const selectedBehavior = AsyncResult.isSuccess(preferencesResult)
    ? (preferencesResult.value.followUpBehavior ?? DEFAULT_FOLLOW_UP_BEHAVIOR)
    : null;
  const selectedScrollBehavior = AsyncResult.isSuccess(preferencesResult)
    ? (preferencesResult.value.sendScrollBehavior ?? DEFAULT_SEND_SCROLL_BEHAVIOR)
    : null;

  const content = (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      className="flex-1"
      contentContainerClassName="gap-3 px-5 pt-4"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
    >
      <SettingsSection title="While the agent is running">
        {FOLLOW_UP_OPTIONS.map((option, index) => (
          <SettingsChoiceRow
            key={option.behavior}
            label={option.label}
            description={option.description}
            selected={selectedBehavior === option.behavior}
            separated={index > 0}
            disabled={!preferencesReady}
            onPress={() => savePreferences({ followUpBehavior: option.behavior })}
          />
        ))}
      </SettingsSection>
      <Text className="px-2 text-sm text-foreground-muted">
        Long-press the send button to use the other option for a single message. With a hardware
        keyboard, hold {Platform.OS === "android" ? "Ctrl" : "Command"} while sending.
      </Text>
      <SettingsSection title="After sending">
        {SEND_SCROLL_OPTIONS.map((option, index) => (
          <SettingsChoiceRow
            key={option.behavior}
            label={option.label}
            description={option.description}
            selected={selectedScrollBehavior === option.behavior}
            separated={index > 0}
            disabled={!preferencesReady}
            onPress={() => savePreferences({ sendScrollBehavior: option.behavior })}
          />
        ))}
      </SettingsSection>
    </ScrollView>
  );

  return <SettingsScreen title="Chat">{content}</SettingsScreen>;
}
