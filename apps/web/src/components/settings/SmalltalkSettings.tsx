import { useState } from "react";
import { SYSTEM_SMALLTALK_PRESET, type SmalltalkPreset } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import { useEnvironmentProviders } from "../../state/environments";
import { providerInstanceEntriesFor } from "../../providerInstances";
import {
  resolveAppModelSelectionState,
  getCustomModelOptionsByInstance,
} from "../../modelSelection";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { SettingsRow, SettingsSection, SETTINGS_PICKER_TRIGGER_CLASSNAME } from "./settingsLayout";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../ui/select";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { randomUUID } from "../../lib/utils";
import { searchableSetting } from "./settingsSearch";

export function SmalltalkSettings() {
  const settings = useScopedSettings();
  const update = useUpdateScopedSettings();
  const { environment, target } = useSettingsScope();
  const providersByEnvironment = useEnvironmentProviders();
  const providers = (
    environment ? (providersByEnvironment.get(environment.environmentId) ?? []) : []
  ).filter(
    (provider) =>
      (provider.driver === "codex" || provider.driver === "claudeAgent") &&
      provider.supportsTextGeneration !== false,
  );
  const entries = providerInstanceEntriesFor(providers, settings, target?.projectId ?? null);
  const selection = resolveAppModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection:
        settings.smalltalkModelSelection ?? settings.textGenerationModelSelection,
    },
    providers,
  );
  const options = getCustomModelOptionsByInstance(
    settings,
    providers,
    selection.instanceId,
    selection.model,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const presets = [SYSTEM_SMALLTALK_PRESET, ...settings.smalltalkPresets];
  const selected =
    presets.find((preset) => preset.id === (editingId ?? settings.smalltalkDefaultPresetId)) ??
    SYSTEM_SMALLTALK_PRESET;
  const readOnly = selected.id === SYSTEM_SMALLTALK_PRESET.id;
  const duplicate = () => {
    const preset = { ...selected, id: randomUUID(), name: `${selected.name} copy` };
    update({ smalltalkPresets: [...settings.smalltalkPresets, preset] });
    setEditingId(preset.id);
  };
  return (
    <SettingsSection id="smalltalk" title="Smalltalk">
      <SettingsRow
        serverScoped
        settingKeys={["smalltalkModelSelection"]}
        {...searchableSetting("smalltalk-model")}
        description="Explain completed responses using an independently selected model."
        control={
          environment && entries.length > 0 ? (
            <ProviderModelPicker
              environmentId={environment.environmentId}
              activeInstanceId={selection.instanceId}
              model={selection.model}
              lockedProvider={null}
              instanceEntries={entries}
              modelOptionsByInstance={options}
              triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
              onInstanceModelChange={(instanceId, model) =>
                update({ smalltalkModelSelection: createModelSelection(instanceId, model) })
              }
            />
          ) : (
            <span className="text-sm text-muted-foreground">
              Connect a supported provider to choose a model.
            </span>
          )
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["smalltalkDefaultPresetId", "smalltalkPresets"]}
        title="Prompt presets"
        description="Choose the instructions used by 说人话. Existing explanations keep their original instructions."
      >
        <div className="flex max-w-2xl flex-col gap-3 py-3">
          <Select
            value={selected.id}
            onValueChange={(value) => {
              if (value) setEditingId(value);
            }}
          >
            <SelectTrigger aria-label="Edit Smalltalk preset">
              <SelectValue>{selected.name}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {presets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.name}
                  {preset.id === settings.smalltalkDefaultPresetId ? " · Default" : ""}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <PresetEditor
            key={`${selected.id}:${selected.name}:${selected.prompt}`}
            preset={selected}
            readOnly={readOnly}
            onSave={(preset) =>
              update({
                smalltalkPresets: settings.smalltalkPresets.map((value) =>
                  value.id === preset.id ? preset : value,
                ),
              })
            }
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={duplicate}>
              {readOnly ? "Copy to edit" : "Duplicate"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={selected.id === settings.smalltalkDefaultPresetId}
              onClick={() => update({ smalltalkDefaultPresetId: selected.id })}
            >
              Use by default
            </Button>
            {!readOnly ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  update({
                    smalltalkPresets: settings.smalltalkPresets.filter(
                      (preset) => preset.id !== selected.id,
                    ),
                    ...(settings.smalltalkDefaultPresetId === selected.id
                      ? { smalltalkDefaultPresetId: SYSTEM_SMALLTALK_PRESET.id }
                      : {}),
                  });
                  setEditingId(SYSTEM_SMALLTALK_PRESET.id);
                }}
              >
                Delete preset
              </Button>
            ) : null}
          </div>
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
function PresetEditor({
  preset,
  readOnly,
  onSave,
}: {
  preset: SmalltalkPreset;
  readOnly: boolean;
  onSave: (preset: SmalltalkPreset) => void;
}) {
  const [name, setName] = useState(preset.name);
  const [prompt, setPrompt] = useState(preset.prompt);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() && prompt.trim())
          onSave({ ...preset, name: name.trim(), prompt: prompt.trim() });
      }}
    >
      <Input
        aria-label="Smalltalk preset name"
        value={name}
        maxLength={100}
        readOnly={readOnly}
        onChange={(event) => setName(event.target.value)}
      />
      <Textarea
        aria-label="Smalltalk preset prompt"
        value={prompt}
        maxLength={8000}
        readOnly={readOnly}
        rows={4}
        onChange={(event) => setPrompt(event.target.value)}
      />
      {!readOnly ? (
        <div>
          <Button type="submit" size="sm" disabled={!name.trim() || !prompt.trim()}>
            Save preset
          </Button>
        </div>
      ) : null}
    </form>
  );
}
