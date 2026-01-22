#!/usr/bin/env node
/**
 * pgcp - PostgreSQL Copy Tool
 *
 * Copy databases like `cp` copies files: `pgcp <source> <destination>`
 */

import fs from 'fs/promises'
import path from 'path'
import type { Provider, ParsedArgs, DumpOptions, DumpResult } from './types.js'
import { getProvider, getProviderFlags } from './providers/index.js'
import {
  COLORS,
  logError,
  logSuccess,
  logInfo,
  logWarn,
  logDim,
  getMaskedUrl,
} from './utils/logging.js'
import { spinner } from './utils/spinner.js'
import { toolExists, commandSucceeds } from './utils/commands.js'
import { loadEnvFiles, resolveEnvVar } from './utils/env.js'

const VERSION = '0.2.0'
const DUMP_DIR = '.pgcp-dumps'
const DEFAULT_SUPABASE_PORT = 54322

// ============================================================================
// Global State (for cleanup)
// ============================================================================

let dumpDirCreated = false
let keepDumpsOption = false
let currentProvider: Provider | null = null

// ============================================================================
// Step Counter
// ============================================================================

class StepCounter {
  private current = 0
  private total: number

  constructor(total: number) {
    this.total = total
  }

  next(message: string): string {
    this.current++
    return `[${this.current}/${this.total}] ${message}`
  }
}

// ============================================================================
// CLI Parsing
// ============================================================================

function showHelp(): void {
  const flags = getProviderFlags()

  console.log(`
${COLORS.bold}pgcp${COLORS.reset} v${VERSION} - PostgreSQL Copy Tool

${COLORS.bold}USAGE${COLORS.reset}
  pgcp [options] <source> <destination>
  pgcp --supabase [options] <source> [port]

${COLORS.bold}ARGUMENTS${COLORS.reset}
  <source>       Source database URL or env:VARNAME
  <destination>  Destination database URL or env:VARNAME
  [port]         Local port (for providers that manage destination)

${COLORS.bold}OPTIONS${COLORS.reset}
  ${flags.map((f) => f.padEnd(20)).join('')}Use specific provider
  --schema-only, -s    Copy schema only, skip data
  --keep-dumps, -k     Keep dump files after completion
  --help, -h           Show this help message

${COLORS.bold}EXAMPLES${COLORS.reset}
  # Copy between any postgres databases
  pgcp postgres://user:pass@remote:5432/prod postgres://localhost:5433/local

  # Use env variables from .env.local
  pgcp env:PROD_DATABASE_URL env:LOCAL_DATABASE_URL

  # Copy schema only
  pgcp --schema-only env:PROD_DB env:LOCAL_DB

  # Supabase mode: copy to local Supabase (manages destination)
  pgcp --supabase env:SUPABASE_DATABASE_URL
  pgcp --supabase env:SUPABASE_DATABASE_URL 54400

${COLORS.bold}ENVIRONMENT${COLORS.reset}
  Automatically loads .env and .env.local from current directory.
  Use the env:VARNAME syntax to reference variables.
`)
}

function parseArgs(loadedEnv: Record<string, string>): ParsedArgs {
  const args = process.argv.slice(2)

  // Find provider flag
  const providerFlags = getProviderFlags()
  const providerFlag = args.find((a) => providerFlags.includes(a)) || null

  // Parse other flags
  const schemaOnly = args.includes('--schema-only') || args.includes('-s')
  const keepDumps = args.includes('--keep-dumps') || args.includes('-k')

  // Get positional arguments
  const positional = args.filter((arg) => !arg.startsWith('-'))

  if (positional.length < 1) {
    logError('Missing required argument: <source>')
    console.log('\nRun "pgcp --help" for usage information.')
    process.exit(1)
  }

  const [sourceArg, secondArg] = positional

  // Resolve source URL
  const sourceUrl = resolveEnvVar(sourceArg, loadedEnv)
  if (!sourceUrl) {
    const varName = sourceArg.slice(4)
    logError(`Environment variable "${varName}" is not set.`)
    logInfo('Check that it exists in .env.local or is exported in your shell.')
    process.exit(1)
  }

  // For providers that manage destination, second arg is port
  // For others, second arg is destination URL
  const provider = getProvider(providerFlag)

  if (provider.managesDestination) {
    // Second arg is optional port
    let destinationPort: number | null = null
    if (secondArg) {
      const parsed = parseInt(secondArg, 10)
      if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
        logError(`Invalid port: ${secondArg}`)
        logInfo('Port must be a number between 1 and 65535.')
        process.exit(1)
      }
      destinationPort = parsed
    }

    return {
      sourceUrl,
      destinationUrl: null,
      destinationPort,
      schemaOnly,
      keepDumps,
      providerFlag,
    }
  } else {
    // Second arg is required destination URL
    if (!secondArg) {
      logError('Missing required argument: <destination>')
      console.log('\nRun "pgcp --help" for usage information.')
      process.exit(1)
    }

    const destinationUrl = resolveEnvVar(secondArg, loadedEnv)
    if (!destinationUrl) {
      const varName = secondArg.slice(4)
      logError(`Environment variable "${varName}" is not set.`)
      logInfo('Check that it exists in .env.local or is exported in your shell.')
      process.exit(1)
    }

    return {
      sourceUrl,
      destinationUrl,
      destinationPort: null,
      schemaOnly,
      keepDumps,
      providerFlag,
    }
  }
}

// ============================================================================
// Prerequisites
// ============================================================================

async function checkPrerequisites(
  provider: Provider,
  steps: StepCounter
): Promise<void> {
  const stepMsg = steps.next('Checking prerequisites')
  spinner.start(stepMsg)

  // Check all required tools
  for (const tool of provider.prerequisites) {
    if (tool === 'docker') {
      // Docker needs special check (daemon must be running)
      if (!(await commandSucceeds('docker', ['info']))) {
        spinner.fail(stepMsg)
        logError('Docker is not running. Please start Docker and try again.')
        process.exit(1)
      }
    } else {
      if (!(await toolExists(tool))) {
        spinner.fail(stepMsg)
        logError(`${tool} is not installed.`)
        if (tool === 'pg_dump' || tool === 'psql') {
          logInfo('Install with: brew install libpq && brew link --force libpq')
        } else if (tool === 'supabase') {
          logInfo('Install with: brew install supabase/tap/supabase')
        }
        process.exit(1)
      }
    }
  }

  // Provider-specific prerequisites
  if (provider.checkPrerequisites) {
    await provider.checkPrerequisites()
  }

  spinner.success(stepMsg.replace('Checking prerequisites', 'Prerequisites OK'))
}

// ============================================================================
// Destination
// ============================================================================

async function checkDestinationConnectivity(
  destinationUrl: string,
  steps: StepCounter
): Promise<void> {
  const stepMsg = steps.next('Checking destination connectivity')
  spinner.start(stepMsg)

  if (!(await commandSucceeds('psql', [destinationUrl, '-c', 'SELECT 1']))) {
    spinner.fail(stepMsg)
    logError('Cannot connect to destination database.')
    logInfo(`URL: ${getMaskedUrl(destinationUrl)}`)
    logInfo('')
    logInfo('Ensure the database is running and accessible.')
    process.exit(1)
  }

  spinner.success(stepMsg.replace('Checking destination connectivity', 'Destination OK'))
}

async function prepareDestination(
  provider: Provider,
  port: number,
  steps: StepCounter
): Promise<string> {
  const stepMsg = steps.next(`Preparing ${provider.name} destination`)
  spinner.start(stepMsg)

  try {
    const url = await provider.prepareDestination!(port)
    spinner.success(stepMsg.replace('Preparing', 'Prepared'))
    return url
  } catch (err) {
    spinner.fail(stepMsg.replace('Preparing', 'Failed to prepare'))
    throw err
  }
}

// ============================================================================
// Dump & Restore
// ============================================================================

async function ensureDumpDir(): Promise<string> {
  const dumpDir = path.join(process.cwd(), DUMP_DIR)
  await fs.mkdir(dumpDir, { recursive: true })
  dumpDirCreated = true
  return dumpDir
}

async function dumpDatabase(
  provider: Provider,
  sourceUrl: string,
  options: DumpOptions,
  steps: StepCounter
): Promise<DumpResult> {
  const stepMsg = steps.next(
    options.schemaOnly ? 'Dumping schema' : 'Dumping database'
  )
  spinner.start(stepMsg)

  try {
    const result = await provider.dump(sourceUrl, options)
    spinner.success(stepMsg.replace('Dumping', 'Dumped'))
    return result
  } catch (err) {
    spinner.fail(stepMsg.replace('Dumping', 'Failed to dump'))
    throw err
  }
}

async function restoreDatabase(
  provider: Provider,
  dumpResult: DumpResult,
  destinationUrl: string,
  options: DumpOptions,
  steps: StepCounter
): Promise<void> {
  const stepMsg = steps.next('Restoring database')
  spinner.start(stepMsg)

  try {
    await provider.restore(dumpResult, destinationUrl, options)
    spinner.success(stepMsg.replace('Restoring', 'Restored'))
  } catch (err) {
    spinner.fail(stepMsg.replace('Restoring', 'Failed to restore'))
    throw err
  }
}

// ============================================================================
// Cleanup
// ============================================================================

async function cleanupDumpDir(): Promise<number> {
  const dumpDir = path.join(process.cwd(), DUMP_DIR)
  let count = 0

  try {
    const entries = await fs.readdir(dumpDir)
    for (const entry of entries) {
      try {
        await fs.unlink(path.join(dumpDir, entry))
        if (!entry.startsWith('.')) {
          count++
        }
      } catch {
        // Ignore errors
      }
    }
    await fs.rmdir(dumpDir)
  } catch {
    // Directory might not exist
  }

  return count
}

async function handleInterrupt(signal: string, exitCode: number): Promise<void> {
  spinner.stop()
  console.log('')
  logWarn(`Received ${signal}, cleaning up...`)

  // Provider cleanup
  if (currentProvider?.cleanup) {
    try {
      await currentProvider.cleanup()
    } catch {
      // Best effort
    }
  }

  // Dump files cleanup
  if (dumpDirCreated && !keepDumpsOption) {
    const count = await cleanupDumpDir()
    if (count > 0) {
      logDim(`Removed ${count} dump file(s)`)
    }
  }

  console.log('')
  process.exit(exitCode)
}

function setupSignalHandlers(): void {
  process.on('SIGINT', () => {
    handleInterrupt('SIGINT', 130).catch(() => process.exit(130))
  })
  process.on('SIGTERM', () => {
    handleInterrupt('SIGTERM', 143).catch(() => process.exit(143))
  })
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    showHelp()
    process.exit(0)
  }

  setupSignalHandlers()

  console.log('')
  console.log(`${COLORS.bold}pgcp${COLORS.reset} v${VERSION} - PostgreSQL Copy Tool`)
  console.log('')

  // Load environment
  const loadedEnv = await loadEnvFiles()
  const envFilesLoaded = Object.keys(loadedEnv).length > 0

  // Parse arguments
  const parsedArgs = parseArgs(loadedEnv)
  keepDumpsOption = parsedArgs.keepDumps

  // Get provider
  const provider = getProvider(parsedArgs.providerFlag)
  currentProvider = provider

  // Show configuration
  if (envFilesLoaded) {
    logSuccess('Loaded environment from .env/.env.local')
  }
  logInfo(`Provider: ${provider.name}`)
  logInfo(`Source: ${getMaskedUrl(parsedArgs.sourceUrl)}`)

  // Calculate steps
  let totalSteps = 4 // prereqs + dump + restore + cleanup
  if (provider.managesDestination) {
    totalSteps += 1 // prepare destination
  } else {
    totalSteps += 1 // check destination connectivity
  }
  if (parsedArgs.keepDumps) {
    totalSteps -= 1 // no cleanup
  }

  const steps = new StepCounter(totalSteps)
  const dumpDir = await ensureDumpDir()

  const dumpOptions: DumpOptions = {
    schemaOnly: parsedArgs.schemaOnly,
    keepDumps: parsedArgs.keepDumps,
    dumpDir,
  }

  let destinationUrl: string

  try {
    // Check prerequisites
    await checkPrerequisites(provider, steps)

    // Prepare or check destination
    if (provider.managesDestination) {
      const port = parsedArgs.destinationPort || DEFAULT_SUPABASE_PORT
      destinationUrl = await prepareDestination(provider, port, steps)
    } else {
      if (!parsedArgs.destinationUrl) {
        logError('Destination URL is required for this provider.')
        process.exit(1)
      }
      destinationUrl = parsedArgs.destinationUrl
      await checkDestinationConnectivity(destinationUrl, steps)
    }

    logInfo(`Destination: ${getMaskedUrl(destinationUrl)}`)
    if (parsedArgs.schemaOnly) {
      logInfo('Mode: Schema only (no data)')
    }
    console.log('')

    // Dump
    const dumpResult = await dumpDatabase(
      provider,
      parsedArgs.sourceUrl,
      dumpOptions,
      steps
    )

    // Restore
    await restoreDatabase(
      provider,
      dumpResult,
      destinationUrl,
      dumpOptions,
      steps
    )

    // Cleanup
    if (!parsedArgs.keepDumps) {
      const stepMsg = steps.next('Cleaning up dump files')
      spinner.start(stepMsg)
      const count = await cleanupDumpDir()
      dumpDirCreated = false
      spinner.success(stepMsg.replace('Cleaning up', `Removed ${count}`))
    } else {
      logInfo(`Dump files preserved in: ${DUMP_DIR}`)
    }

    // Success!
    console.log('')
    logSuccess('Copy complete!')
    console.log('')
    logInfo(`Destination: ${getMaskedUrl(destinationUrl)}`)
    console.log('')
  } catch (err) {
    // Provider cleanup
    if (provider.cleanup) {
      try {
        await provider.cleanup()
      } catch {
        // Best effort
      }
    }

    // Dump cleanup
    if (dumpDirCreated && !parsedArgs.keepDumps) {
      const count = await cleanupDumpDir()
      dumpDirCreated = false
      if (count > 0) {
        console.log('')
        logDim(`Cleaned up ${count} dump file(s).`)
      }
    }

    console.log('')
    logError(`Copy failed: ${err}`)
    console.log('')
    logInfo('Hints:')
    logInfo('  - Check that your source and destination URLs are correct')
    logInfo('  - Ensure both databases are accessible from your network')
    if (provider.managesDestination) {
      logInfo('  - Verify Docker is running')
    }
    process.exit(1)
  }
}

main().catch((err) => {
  logError(`Unexpected error: ${err}`)
  process.exit(1)
})
