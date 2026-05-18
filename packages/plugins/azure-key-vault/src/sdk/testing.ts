import { Effect } from "effect";

import type { AzureKeyVaultClient } from "./plugin";

export const makeMemoryAzureKeyVaultClient = (): AzureKeyVaultClient => {
  const values = new Map<string, string>();
  return {
    getSecret: (name) => Effect.succeed(values.get(name) ?? null),
    hasSecret: (name) => Effect.succeed(values.has(name)),
    setSecret: (name, value) =>
      Effect.sync(() => {
        values.set(name, value);
      }),
    deleteSecret: (name) =>
      Effect.sync(() => {
        const had = values.has(name);
        values.delete(name);
        return had;
      }),
  };
};
