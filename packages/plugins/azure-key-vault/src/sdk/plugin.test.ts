import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { createExecutor, Scope, ScopeId, SecretId, SetSecretInput } from "@executor-js/sdk";
import { makeTestConfig } from "@executor-js/sdk/testing";

import { azureKeyVaultPlugin, vaultSecretName } from "./plugin";
import { makeMemoryAzureKeyVaultClient } from "./testing";

describe("azureKeyVaultPlugin", () => {
  it.effect("partitions secret values by executor scope", () =>
    Effect.gen(function* () {
      const client = makeMemoryAzureKeyVaultClient();
      const plugins = [azureKeyVaultPlugin({ client })] as const;
      const config = makeTestConfig({ plugins });
      const now = new Date();
      const orgScope = Scope.make({
        id: ScopeId.make("org"),
        name: "Org",
        createdAt: now,
      });
      const aliceScope = Scope.make({
        id: ScopeId.make("user-org:alice:org"),
        name: "Alice",
        createdAt: now,
      });
      const bobScope = Scope.make({
        id: ScopeId.make("user-org:bob:org"),
        name: "Bob",
        createdAt: now,
      });

      const alice = yield* createExecutor({
        ...config,
        scopes: [aliceScope, orgScope],
        plugins,
        onElicitation: "accept-all",
      });
      const bob = yield* createExecutor({
        ...config,
        scopes: [bobScope, orgScope],
        plugins,
        onElicitation: "accept-all",
      });

      yield* alice.secrets.set(
        SetSecretInput.make({
          id: SecretId.make("azure-devops-pat"),
          scope: aliceScope.id,
          name: "Azure DevOps PAT",
          value: "alice-pat",
          provider: "azure-key-vault",
        }),
      );
      yield* bob.secrets.set(
        SetSecretInput.make({
          id: SecretId.make("azure-devops-pat"),
          scope: bobScope.id,
          name: "Azure DevOps PAT",
          value: "bob-pat",
          provider: "azure-key-vault",
        }),
      );

      expect(yield* alice.secrets.get("azure-devops-pat")).toBe("alice-pat");
      expect(yield* bob.secrets.get("azure-devops-pat")).toBe("bob-pat");
    }),
  );

  it("uses Key Vault-compatible deterministic secret names", () => {
    const name = vaultSecretName("user-org:alice:org", "azure/devops/pat");
    expect(name).toMatch(/^executor-[A-Za-z0-9-]+-[A-Za-z0-9-]+$/);
    expect(name.length).toBeLessThanOrEqual(127);
  });
});
