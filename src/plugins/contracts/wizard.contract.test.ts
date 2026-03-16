import { describe, expect, it } from "vitest";
import {
  buildProviderModelPickerEntriesFromProviders,
  buildProviderPluginMethodChoice,
  buildProviderWizardOptionsFromProviders,
  resolveProviderPluginChoice,
} from "../provider-wizard.js";
import type { ProviderPlugin } from "../types.js";
import { providerContractRegistry } from "./registry.js";

const bundledProviders = providerContractRegistry.map((entry) => entry.provider);

function resolveExpectedWizardChoiceValues(providers: ProviderPlugin[]) {
  const values: string[] = [];

  for (const provider of providers) {
    const methodSetups = provider.auth.filter((method) => method.wizard);
    if (methodSetups.length > 0) {
      values.push(
        ...methodSetups.map(
          (method) =>
            method.wizard?.choiceId?.trim() ||
            buildProviderPluginMethodChoice(provider.id, method.id),
        ),
      );
      continue;
    }

    const setup = provider.wizard?.setup;
    if (!setup) {
      continue;
    }

    const explicitMethodId = setup.methodId?.trim();
    if (explicitMethodId && provider.auth.some((method) => method.id === explicitMethodId)) {
      values.push(
        setup.choiceId?.trim() || buildProviderPluginMethodChoice(provider.id, explicitMethodId),
      );
      continue;
    }

    values.push(
      ...provider.auth.map((method) => buildProviderPluginMethodChoice(provider.id, method.id)),
    );
  }

  return values.toSorted((left, right) => left.localeCompare(right));
}

function resolveExpectedModelPickerValues(providers: ProviderPlugin[]) {
  return providers
    .flatMap((provider) => {
      const modelPicker = provider.wizard?.modelPicker;
      if (!modelPicker) {
        return [];
      }
      const explicitMethodId = modelPicker.methodId?.trim();
      if (explicitMethodId) {
        return [buildProviderPluginMethodChoice(provider.id, explicitMethodId)];
      }
      if (provider.auth.length === 1) {
        return [provider.id];
      }
      return [buildProviderPluginMethodChoice(provider.id, provider.auth[0]?.id ?? "default")];
    })
    .toSorted((left, right) => left.localeCompare(right));
}

describe.skipIf(process.platform === "win32")("provider wizard contract", () => {
  it("exposes every registered provider setup choice through the shared wizard layer", () => {
    const options = buildProviderWizardOptionsFromProviders(bundledProviders);

    expect(
      options.map((option) => option.value).toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(resolveExpectedWizardChoiceValues(bundledProviders));
    expect(options.map((option) => option.value)).toEqual([
      ...new Set(options.map((option) => option.value)),
    ]);
  });

  it("round-trips every shared wizard choice back to its provider and auth method", () => {
    for (const option of buildProviderWizardOptionsFromProviders(bundledProviders)) {
      const resolved = resolveProviderPluginChoice({
        providers: bundledProviders,
        choice: option.value,
      });
      expect(resolved).not.toBeNull();
      expect(resolved?.provider.id).toBeTruthy();
      expect(resolved?.method.id).toBeTruthy();
    }
  });

  it("exposes every registered model-picker entry through the shared wizard layer", () => {
    const entries = buildProviderModelPickerEntriesFromProviders(bundledProviders);

    expect(
      entries.map((entry) => entry.value).toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(resolveExpectedModelPickerValues(bundledProviders));
    for (const entry of entries) {
      const resolved = resolveProviderPluginChoice({
        providers: bundledProviders,
        choice: entry.value,
      });
      expect(resolved).not.toBeNull();
    }
  });
});
