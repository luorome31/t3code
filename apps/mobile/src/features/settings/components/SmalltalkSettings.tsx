import { useEnvironmentServerConfig } from "../../../state/entities";
import { useState } from "react";
import { View } from "react-native";
import {
  isSmalltalkTextGenerationDriver,
  type ServerSettings,
  type ServerSettingsPatch,
  type EnvironmentId,
  type SmalltalkPreset,
  SYSTEM_SMALLTALK_PRESET,
} from "@t3tools/contracts";
import { uuidv4 } from "../../../lib/uuid";
import { AppText as Text, AppTextInput } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import { Menu } from "../../../components/ui/Menu";
import { SettingsSection } from "./SettingsSection";
import { buildModelOptions } from "../../../lib/modelOptions";

export function SmalltalkSettings({
  settings,
  environmentId,
  disabled,
  onChange,
}: {
  settings: ServerSettings;
  environmentId: EnvironmentId;
  disabled: boolean;
  onChange: (patch: ServerSettingsPatch) => void;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  const [editingId, setEditingId] = useState(settings.smalltalkDefaultPresetId);
  const presets = [SYSTEM_SMALLTALK_PRESET, ...settings.smalltalkPresets];
  const selected = presets.find((preset) => preset.id === editingId) ?? SYSTEM_SMALLTALK_PRESET;
  const model = settings.smalltalkModelSelection ?? settings.textGenerationModelSelection;
  const supportedInstanceIds: ReadonlySet<string> = new Set(
    (config?.providers ?? [])
      .filter(
        (provider) =>
          isSmalltalkTextGenerationDriver(provider.driver) &&
          provider.supportsTextGeneration !== false,
      )
      .map((provider) => provider.instanceId),
  );
  const models = buildModelOptions(
    config ? { ...config, settings } : null,
    model,
    undefined,
    null,
  ).filter((entry) => supportedInstanceIds.has(entry.providerKey));
  return (
    <SettingsSection title="Smalltalk">
      <View className="gap-3 p-4">
        <Menu
          accessibilityLabel="Smalltalk model"
          actions={models.map((entry) => ({
            id: entry.key,
            title: `${entry.providerLabel} · ${entry.label}`,
            attributes: { disabled: disabled || entry.isUnavailable === true },
          }))}
          onPressAction={({ nativeEvent }) => {
            const selectedModel = models.find((entry) => entry.key === nativeEvent.event);
            if (selectedModel && !disabled)
              onChange({ smalltalkModelSelection: selectedModel.selection });
          }}
        >
          <Text className="text-primary-text">Model: {model.model}</Text>
        </Menu>
        <Menu
          accessibilityLabel="Smalltalk prompt preset"
          actions={presets.map((preset) => ({ id: preset.id, title: preset.name }))}
          onPressAction={({ nativeEvent }) => setEditingId(nativeEvent.event)}
        >
          <Text className="text-primary-text">Prompt: {selected.name}</Text>
        </Menu>
        <PresetEditor
          key={`${selected.id}:${selected.name}:${selected.prompt}`}
          preset={selected}
          disabled={disabled}
          onSave={(preset) =>
            onChange({
              smalltalkPresets: settings.smalltalkPresets.map((value) =>
                value.id === preset.id ? preset : value,
              ),
            })
          }
        />
        <Button
          label="Copy to edit"
          disabled={disabled}
          onPress={() => {
            const preset = { ...selected, id: uuidv4(), name: `${selected.name} copy` };
            onChange({ smalltalkPresets: [...settings.smalltalkPresets, preset] });
            setEditingId(preset.id);
          }}
        />
        <Button
          label={
            selected.id === settings.smalltalkDefaultPresetId ? "Default preset" : "Use by default"
          }
          disabled={disabled || selected.id === settings.smalltalkDefaultPresetId}
          onPress={() => onChange({ smalltalkDefaultPresetId: selected.id })}
        />
        {selected.id !== SYSTEM_SMALLTALK_PRESET.id ? (
          <Button
            label="Delete preset"
            tone="danger"
            disabled={disabled}
            onPress={() => {
              onChange({
                smalltalkPresets: settings.smalltalkPresets.filter(
                  (preset) => preset.id !== selected.id,
                ),
                ...(selected.id === settings.smalltalkDefaultPresetId
                  ? { smalltalkDefaultPresetId: SYSTEM_SMALLTALK_PRESET.id }
                  : {}),
              });
              setEditingId(SYSTEM_SMALLTALK_PRESET.id);
            }}
          />
        ) : null}
      </View>
    </SettingsSection>
  );
}
function PresetEditor({
  preset,
  disabled,
  onSave,
}: {
  preset: SmalltalkPreset;
  disabled: boolean;
  onSave: (preset: SmalltalkPreset) => void;
}) {
  const [name, setName] = useState(preset.name);
  const [prompt, setPrompt] = useState(preset.prompt);
  const readOnly = preset.id === SYSTEM_SMALLTALK_PRESET.id || disabled;
  return (
    <View className="gap-3">
      <AppTextInput
        accessibilityLabel="Smalltalk preset name"
        value={name}
        editable={!readOnly}
        maxLength={100}
        onChangeText={setName}
        className="rounded-xl bg-secondary p-3 text-foreground"
      />
      <AppTextInput
        accessibilityLabel="Smalltalk preset prompt"
        value={prompt}
        editable={!readOnly}
        maxLength={8000}
        multiline
        onChangeText={setPrompt}
        className="rounded-xl bg-secondary p-3 text-foreground"
      />
      {!readOnly ? (
        <Button
          label="Save preset"
          disabled={!name.trim() || !prompt.trim()}
          onPress={() => onSave({ ...preset, name: name.trim(), prompt: prompt.trim() })}
        />
      ) : null}
    </View>
  );
}
