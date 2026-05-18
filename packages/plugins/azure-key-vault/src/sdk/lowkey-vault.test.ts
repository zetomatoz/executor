import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { SecretClient } from "@azure/keyvault-secrets";
import { GenericContainer, Wait } from "testcontainers";

import { StorageError } from "@executor-js/sdk/core";

import { makeAzureKeyVaultSecretProvider } from "./plugin";

const runLowkeyTests = process.env.EXECUTOR_LOWKEY_VAULT_TESTS === "true";

describe.skipIf(!runLowkeyTests)("azureKeyVaultPlugin Lowkey Vault integration", () => {
  it.effect("stores and reads a scoped secret through Lowkey Vault", () =>
    Effect.gen(function* () {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
      const container = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () =>
            new GenericContainer("nagyesta/lowkey-vault:7.0.9-ubi10-minimal")
              .withExposedPorts({ container: 8443, host: 8443 })
              .withWaitStrategy(Wait.forHttp("/ping", 8443).usingTls())
              .start(),
          catch: (cause) => new StorageError({ message: "Lowkey Vault container failed", cause }),
        }),
        (container) =>
          Effect.ignore(
            Effect.tryPromise({
              try: () => container.stop(),
              catch: (cause) =>
                new StorageError({ message: "Lowkey Vault container cleanup failed", cause }),
            }),
          ),
      );
      expect(container.getMappedPort(8443)).toBe(8443);

      const credential = {
        getToken: async () => ({
          token: "lowkey-test-token",
          expiresOnTimestamp: Date.now() + 60_000,
        }),
      };
      const client = new SecretClient("https://localhost:8443", credential, {
        disableChallengeResourceVerification: true,
      });
      const provider = makeAzureKeyVaultSecretProvider({
        client: {
          getSecret: (name) =>
            Effect.tryPromise({
              try: async () => (await client.getSecret(name)).value ?? null,
              catch: (cause) => new StorageError({ message: "Lowkey Vault get failed", cause }),
            }),
          setSecret: (name, value) =>
            Effect.tryPromise({
              try: async () => {
                await client.setSecret(name, value);
              },
              catch: (cause) => new StorageError({ message: "Lowkey Vault set failed", cause }),
            }),
          deleteSecret: (name) =>
            Effect.tryPromise({
              try: async () => {
                await client.beginDeleteSecret(name);
                return true;
              },
              catch: (cause) => new StorageError({ message: "Lowkey Vault delete failed", cause }),
            }),
        },
      });

      yield* provider.set!("pat", "secret-value", "user-org:alice:org");
      const value = yield* provider.get("pat", "user-org:alice:org");
      expect(value).toBe("secret-value");
    }),
  );
});
