import {
  type EnvironmentId,
  ProviderInstanceId,
  type ServerProvider,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { sortByPreferredOrder } from "@t3tools/shared/Array";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useState } from "react";
import { useUpdateEnvironmentModelPreferences } from "../../hooks/useSettings";
import {
  providerModelKey,
  sortModelsForProviderInstance,
  sortProviderModelItems,
} from "../../modelOrdering";
import { Button } from "../ui/button";
import { SettingsRow, SettingsSection, SettingResetButton } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function ModelPickerOrderSettings(props: {
  readonly environmentId: EnvironmentId;
  readonly settings: UnifiedSettings;
  readonly providers: ReadonlyArray<{
    readonly instanceId: ProviderInstanceId;
    readonly displayName: string;
  }>;
  readonly serverProviders: ReadonlyArray<ServerProvider>;
  readonly disabled: boolean;
}) {
  const save = useUpdateEnvironmentModelPreferences(props.environmentId);
  const { settings } = props;
  const modelOrder = props.serverProviders.flatMap((provider) =>
    sortModelsForProviderInstance(provider.models, {
      modelOrder: settings.providerModelPreferences[provider.instanceId]?.modelOrder ?? [],
    }).map((model) => providerModelKey(provider.instanceId, model.slug)),
  );
  const favorites = sortProviderModelItems(
    sortByPreferredOrder(
      settings.favorites.map((favorite) => ({
        instanceId: favorite.provider,
        slug: favorite.model,
      })),
      modelOrder,
      (model) => providerModelKey(model.instanceId, model.slug),
    ),
    {
      instanceOrder: props.providers.map((provider) => provider.instanceId),
      favoriteModelOrder: settings.favoriteModelOrder.map((favorite) =>
        providerModelKey(favorite.provider, favorite.model),
      ),
    },
  );

  return (
    <SettingsSection {...searchableSetting("model-picker-order")}>
      <OrderList
        title="Provider order"
        description="Choose the provider order in model pickers."
        disabled={props.disabled}
        items={props.providers.map((provider) => ({
          key: provider.instanceId,
          label: provider.displayName,
        }))}
        onChange={(keys) =>
          save({ providerOrder: keys.map((key) => ProviderInstanceId.make(key)) })
        }
        onReset={settings.providerOrder.length > 0 ? () => save({ providerOrder: [] }) : undefined}
      />
      <OrderList
        title="Favorite model order"
        description="Arrange favorites across all providers."
        disabled={props.disabled}
        items={favorites.map((favorite) => {
          const provider = props.serverProviders.find(
            (provider) => provider.instanceId === favorite.instanceId,
          );
          const model = provider?.models.find((model) => model.slug === favorite.slug);
          return {
            key: providerModelKey(favorite.instanceId, favorite.slug),
            label: model?.name ?? favorite.slug,
            detail:
              props.providers.find((provider) => provider.instanceId === favorite.instanceId)
                ?.displayName ?? favorite.instanceId,
          };
        })}
        emptyMessage="Star models in the model picker to arrange them here."
        onChange={(keys) => {
          const byKey = new Map(
            settings.favorites.map((favorite) => [
              providerModelKey(favorite.provider, favorite.model),
              favorite,
            ]),
          );
          return save({ favoriteModelOrder: keys.flatMap((key) => byKey.get(key) ?? []) });
        }}
        onReset={
          settings.favoriteModelOrder.length > 0
            ? () => save({ favoriteModelOrder: [] })
            : undefined
        }
      />
    </SettingsSection>
  );
}

function OrderList(props: {
  readonly title: string;
  readonly description: string;
  readonly items: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly detail?: string;
  }>;
  readonly disabled: boolean;
  readonly emptyMessage?: string;
  readonly onChange: (keys: ReadonlyArray<string>) => Promise<unknown>;
  readonly onReset?: (() => Promise<unknown>) | undefined;
}) {
  const [saving, setSaving] = useState(false);
  const persist = async (write: () => Promise<unknown>) => {
    setSaving(true);
    await write().finally(() => setSaving(false));
  };
  const move = (index: number, direction: -1 | 1) => {
    const keys = props.items.map((item) => item.key);
    const target = index + direction;
    if (saving || props.disabled || target < 0 || target >= keys.length) return;
    [keys[index], keys[target]] = [keys[target]!, keys[index]!];
    void persist(() => props.onChange(keys));
  };

  return (
    <div>
      <SettingsRow
        title={props.title}
        description={props.description}
        resetAction={
          props.onReset ? (
            <SettingResetButton
              label={props.title.toLowerCase()}
              disabled={props.disabled || saving}
              onClick={() => {
                if (props.onReset) void persist(props.onReset);
              }}
            />
          ) : null
        }
      />
      {props.items.length === 0 ? (
        <p className="px-3 pb-3 text-xs text-muted-foreground sm:px-4">{props.emptyMessage}</p>
      ) : (
        <ol
          aria-label={props.title}
          aria-busy={saving}
          className="max-h-64 overflow-y-auto px-3 pb-3 sm:px-4"
        >
          {props.items.map((item, index) => (
            <li key={item.key} className="flex min-h-9 items-center gap-3 py-1 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {item.label}
                {item.detail ? (
                  <span className="ml-2 text-xs text-muted-foreground">{item.detail}</span>
                ) : null}
              </span>
              <Button
                size="icon-xs"
                variant="ghost-muted"
                disabled={props.disabled || saving || index === 0}
                onClick={() => move(index, -1)}
                aria-label={`Move ${item.label}${item.detail ? ` (${item.detail})` : ""} up`}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost-muted"
                disabled={props.disabled || saving || index === props.items.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Move ${item.label}${item.detail ? ` (${item.detail})` : ""} down`}
              >
                <ArrowDownIcon />
              </Button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
