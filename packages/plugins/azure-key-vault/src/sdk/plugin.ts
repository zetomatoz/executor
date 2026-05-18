import { Effect } from "effect";
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

import {
  definePlugin,
  StorageError,
  type SecretProvider,
  type StorageFailure,
} from "@executor-js/sdk/core";

export const AZURE_KEY_VAULT_PROVIDER_KEY = "azure-key-vault";

export interface AzureKeyVaultClient {
  readonly getSecret: (name: string) => Effect.Effect<string | null, StorageFailure>;
  readonly hasSecret?: (name: string) => Effect.Effect<boolean, StorageFailure>;
  readonly setSecret: (name: string, value: string) => Effect.Effect<void, StorageFailure>;
  readonly deleteSecret: (name: string) => Effect.Effect<boolean, StorageFailure>;
}

export interface AzureKeyVaultPluginOptions {
  readonly client?: AzureKeyVaultClient;
  readonly vaultUrl?: string;
  readonly namePrefix?: string;
}

export interface AzureKeyVaultSecretProviderOptions {
  readonly client: AzureKeyVaultClient;
  readonly namePrefix?: string;
}

const encodeNamePart = (value: string): string =>
  Buffer.from(value, "utf8")
    .toString("base64url")
    .replace(/[^A-Za-z0-9-]/g, "-");

export const vaultSecretName = (scope: string, secretId: string, prefix = "executor"): string =>
  `${prefix}-${encodeNamePart(scope)}-${encodeNamePart(secretId)}`.slice(0, 127);

const toStorageError = (operation: string, cause: unknown) =>
  new StorageError({
    message: `Azure Key Vault ${operation} failed`,
    cause,
  });

const isNotFound = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "statusCode" in cause &&
  (cause as { readonly statusCode?: unknown }).statusCode === 404;

const makeSdkAzureKeyVaultClient = (
  vaultUrl: string,
): Effect.Effect<AzureKeyVaultClient, StorageFailure> =>
  Effect.sync(() => {
    const client = new SecretClient(vaultUrl, new DefaultAzureCredential());

    return {
      getSecret: (name) =>
        Effect.tryPromise({
          try: async () => (await client.getSecret(name)).value ?? null,
          catch: (cause) => toStorageError("getSecret", cause),
        }).pipe(
          Effect.catchTag("StorageError", (error) =>
            isNotFound(error.cause) ? Effect.succeed(null) : Effect.fail(error),
          ),
        ),
      hasSecret: (name) =>
        Effect.tryPromise({
          try: async () => {
            await client.getSecret(name);
            return true;
          },
          catch: (cause) => toStorageError("hasSecret", cause),
        }).pipe(
          Effect.catchTag("StorageError", (error) =>
            isNotFound(error.cause) ? Effect.succeed(false) : Effect.fail(error),
          ),
        ),
      setSecret: (name, value) =>
        Effect.tryPromise({
          try: async () => {
            await client.setSecret(name, value);
          },
          catch: (cause) => toStorageError("setSecret", cause),
        }),
      deleteSecret: (name) =>
        Effect.tryPromise({
          try: async () => {
            const poller = await client.beginDeleteSecret(name);
            await poller.pollUntilDone();
            return true;
          },
          catch: (cause) => toStorageError("deleteSecret", cause),
        }).pipe(
          Effect.catchTag("StorageError", (error) =>
            isNotFound(error.cause) ? Effect.succeed(false) : Effect.fail(error),
          ),
        ),
    };
  });

export const makeAzureKeyVaultSecretProvider = (
  options: AzureKeyVaultSecretProviderOptions,
): SecretProvider => {
  const prefix = options.namePrefix ?? "executor";
  const nameFor = (id: string, scope: string) => vaultSecretName(scope, id, prefix);

  return {
    key: AZURE_KEY_VAULT_PROVIDER_KEY,
    writable: true,
    allowFallback: false,
    get: (id, scope) => options.client.getSecret(nameFor(id, scope)),
    has: (id, scope) =>
      options.client.hasSecret
        ? options.client.hasSecret(nameFor(id, scope))
        : options.client.getSecret(nameFor(id, scope)).pipe(Effect.map((value) => value !== null)),
    set: (id, value, scope) => options.client.setSecret(nameFor(id, scope), value),
    delete: (id, scope) => options.client.deleteSecret(nameFor(id, scope)),
  };
};

const makeAzureKeyVaultExtension = () =>
  ({
    providerKey: AZURE_KEY_VAULT_PROVIDER_KEY,
  }) as const;

export type AzureKeyVaultExtension = ReturnType<typeof makeAzureKeyVaultExtension>;

export const azureKeyVaultPlugin = definePlugin((options?: AzureKeyVaultPluginOptions) => ({
  id: "azureKeyVault" as const,
  packageName: "@executor-js/plugin-azure-key-vault",
  storage: () => ({}),
  extension: makeAzureKeyVaultExtension,
  secretProviders: () => {
    const client = options?.client
      ? options.client
      : Effect.runSync(
          options?.vaultUrl
            ? makeSdkAzureKeyVaultClient(options.vaultUrl)
            : Effect.fail(
                new StorageError({
                  message: "azureKeyVaultPlugin requires `client` or `vaultUrl`",
                  cause: undefined,
                }),
              ),
        );
    return [
      makeAzureKeyVaultSecretProvider({
        client,
        namePrefix: options?.namePrefix,
      }),
    ];
  },
}));
