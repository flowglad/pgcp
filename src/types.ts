/**
 * Core types for pgcp
 */

export interface DumpResult {
  files: string[]
  metadata?: Record<string, unknown>
}

export interface DumpOptions {
  schemaOnly: boolean
  keepDumps: boolean
  dumpDir: string
}

export interface Provider {
  /** Unique identifier for this provider */
  id: string

  /** Display name for UI */
  name: string

  /** CLI flag that activates this provider (e.g., '--supabase') */
  flag: string | null

  /** Tools required to be installed */
  prerequisites: string[]

  /** Whether this provider manages its own destination (e.g., local Supabase) */
  managesDestination: boolean

  /**
   * Check provider-specific prerequisites beyond tool existence
   * (e.g., Docker running, config files present)
   */
  checkPrerequisites?(): Promise<void>

  /**
   * Prepare the destination (only called if managesDestination is true)
   * Takes the destination URL provided by user
   */
  prepareDestination?(destinationUrl: string): Promise<void>

  /**
   * Dump from source database
   */
  dump(sourceUrl: string, options: DumpOptions): Promise<DumpResult>

  /**
   * Restore to destination database
   */
  restore(
    dumpResult: DumpResult,
    destinationUrl: string,
    options: DumpOptions
  ): Promise<void>

  /**
   * Provider-specific cleanup (called on success or failure)
   */
  cleanup?(): Promise<void>
}

export interface ParsedArgs {
  sourceUrl: string
  destinationUrl: string
  schemaOnly: boolean
  keepDumps: boolean
  providerFlag: string | null
}

export interface ResolvedOptions {
  sourceUrl: string
  destinationUrl: string
  schemaOnly: boolean
  keepDumps: boolean
  provider: Provider
}
