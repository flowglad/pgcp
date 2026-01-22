/**
 * Provider registry
 *
 * All available providers are registered here.
 * The default provider (VanillaPostgresProvider) has flag: null.
 */

import type { Provider } from '../types.js'
import { VanillaPostgresProvider, SupabaseProvider } from './postgres/index.js'

/**
 * All registered providers.
 * Order matters: first matching flag wins.
 */
export const providers: Provider[] = [
  SupabaseProvider,
  VanillaPostgresProvider, // Default (no flag)
]

/**
 * Get provider by flag.
 * Returns the default provider if flag is null.
 */
export function getProvider(flag: string | null): Provider {
  if (flag === null) {
    const defaultProvider = providers.find((p) => p.flag === null)
    if (!defaultProvider) {
      throw new Error('No default provider configured')
    }
    return defaultProvider
  }

  const provider = providers.find((p) => p.flag === flag)
  if (!provider) {
    const validFlags = providers
      .filter((p) => p.flag !== null)
      .map((p) => p.flag)
      .join(', ')
    throw new Error(
      `Unknown provider flag: ${flag}. Valid flags: ${validFlags}`
    )
  }

  return provider
}

/**
 * Get all valid provider flags for help text.
 */
export function getProviderFlags(): string[] {
  return providers.filter((p) => p.flag !== null).map((p) => p.flag!)
}
