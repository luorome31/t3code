import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { searchableSetting } from "./settingsSearch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";

const modes = [
  { value: "off", label: "Off" },
  { value: "timeline", label: "Left timeline" },
  { value: "questions", label: "Question outline" },
] as const;

export function ConversationNavigationSettings() {
  const mode = useClientSettings((settings) => settings.conversationNavigation);
  return (
    <SettingsSection id="navigation" title="Navigation">
      <SettingsRow
        {...searchableSetting("conversation-navigation")}
        description="Choose a left timeline or a question outline in thread details. This preference applies to this client."
        resetAction={
          mode !== DEFAULT_CLIENT_SETTINGS.conversationNavigation ? (
            <SettingResetButton
              label="conversation navigation"
              onClick={() =>
                updateClientSettings({
                  conversationNavigation: DEFAULT_CLIENT_SETTINGS.conversationNavigation,
                })
              }
            />
          ) : null
        }
        control={
          <Select
            value={mode}
            onValueChange={(value) => {
              const selected = modes.find((option) => option.value === value);
              if (selected) updateClientSettings({ conversationNavigation: selected.value });
            }}
          >
            <SelectTrigger size="sm" aria-label="Conversation navigation">
              <SelectValue>{modes.find((option) => option.value === mode)?.label}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {modes.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </SettingsSection>
  );
}
