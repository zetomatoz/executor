// Single shared instantiation of the cloud plugin list.
//
// `executor.config.ts`'s `plugins()` factory is safe to call at
// module-eval time without runtime credentials: the heavy per-request
// dependencies (WorkOS Vault credentials, vault HTTP client) are only
// consumed when the plugin's extension is actually constructed inside
// `createScopedExecutor`. Both the API composition (`protected-layers.ts`)
// and the per-request middleware (`protected.ts` + the test harness)
// derive their typed views — `composePluginApi(cloudPlugins)`,
// `composePluginHandlerLayer(cloudPlugins)`,
// `providePluginExtensions(cloudPlugins)`, `PluginExtensionServices<typeof
// cloudPlugins>` — from this one tuple, so adding/removing a plugin is
// still a single `executor.config.ts` edit.
import executorConfig from "../../executor.config";
import { env } from "cloudflare:workers";

export const cloudPlugins = executorConfig.plugins({
  secretProvider:
    env.EXECUTOR_SECRET_PROVIDER === "azure-key-vault" ? "azure-key-vault" : "workos-vault",
  azureKeyVaultUrl: env.AZURE_KEY_VAULT_URL,
  azureKeyVaultNamePrefix: env.AZURE_KEY_VAULT_NAME_PREFIX,
});
export type CloudPlugins = typeof cloudPlugins;
