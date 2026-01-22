/**
 * Supabase PostgreSQL provider
 *
 * Uses Supabase CLI for dumping and manages local Supabase for destination.
 */

import fs from 'fs/promises'
import path from 'path'
import type { Provider, DumpResult, DumpOptions } from '../../types.js'
import {
  runCommand,
  runCommandAsync,
  commandSucceeds,
  sleep,
} from '../../utils/commands.js'
import { logError, logInfo } from '../../utils/logging.js'

const DEFAULT_PORT = 54322
const HEALTH_CHECK_RETRIES = 30
const HEALTH_CHECK_INTERVAL_MS = 1000

const projectDir = process.cwd()
const configPath = path.join(projectDir, 'supabase', 'config.toml')
const configBackupPath = path.join(
  projectDir,
  'supabase',
  'config.toml.pgcp-backup'
)

let configWasModified = false

function getLocalDbUrl(port: number): string {
  return `postgresql://postgres:postgres@localhost:${port}/postgres`
}

async function modifyConfigPort(port: number): Promise<void> {
  if (port === DEFAULT_PORT) {
    return
  }

  const content = await fs.readFile(configPath, 'utf-8')
  await fs.writeFile(configBackupPath, content)

  const lines = content.split('\n')
  let inDbSection = false
  let modified = false

  const newLines = lines.map((line) => {
    const trimmed = line.trim()

    if (trimmed.startsWith('[')) {
      inDbSection = trimmed === '[db]'
      return line
    }

    if (trimmed.startsWith('#') || trimmed === '') {
      return line
    }

    if (inDbSection && trimmed.startsWith('port')) {
      const match = line.match(/^(\s*port\s*=\s*)\d+(.*)$/)
      if (match) {
        modified = true
        return `${match[1]}${port}${match[2]}`
      }
    }

    return line
  })

  if (!modified) {
    await fs.unlink(configBackupPath)
    throw new Error(
      `Failed to configure custom port ${port}: [db].port not found in supabase/config.toml`
    )
  }

  await fs.writeFile(configPath, newLines.join('\n'))
  configWasModified = true
}

async function restoreConfig(): Promise<void> {
  try {
    const backup = await fs.readFile(configBackupPath, 'utf-8')
    await fs.writeFile(configPath, backup)
    await fs.unlink(configBackupPath)
    configWasModified = false
  } catch {
    // Backup might not exist
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

async function grantRolesToPostgres(localDbUrl: string): Promise<void> {
  const rolesQuery =
    "SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg_%' AND rolname != 'postgres' AND NOT rolsuper"

  try {
    const result = await runCommand(
      'psql',
      [localDbUrl, '-t', '-A', '-c', rolesQuery],
      { silent: true }
    )

    const roles = result.split('\n').filter((r) => r.trim())
    for (const role of roles) {
      try {
        const quotedRole = quoteIdentifier(role)
        await runCommand(
          'psql',
          [localDbUrl, '-c', `GRANT ${quotedRole} TO postgres;`],
          { silent: true }
        )
      } catch {
        // Role might already be granted
      }
    }
  } catch {
    // Ignore errors
  }
}

export const SupabaseProvider: Provider = {
  id: 'supabase',
  name: 'Supabase',
  flag: '--supabase',
  prerequisites: ['supabase', 'psql', 'docker'],
  managesDestination: true,

  async checkPrerequisites(): Promise<void> {
    // Check Docker is running
    if (!(await commandSucceeds('docker', ['info']))) {
      logError('Docker is not running. Please start Docker and try again.')
      process.exit(1)
    }

    // Check supabase/config.toml exists
    if (!(await commandSucceeds('test', ['-f', configPath]))) {
      logError('Supabase is not initialized in this project.')
      logInfo('Run: supabase init')
      process.exit(1)
    }
  },

  async prepareDestination(port: number): Promise<string> {
    const destinationUrl = getLocalDbUrl(port)

    // Stop existing Supabase
    try {
      await runCommand('supabase', ['stop', '--no-backup'], { silent: true })
    } catch {
      // Containers might not be running
    }

    // Modify config.toml if using custom port
    if (port !== DEFAULT_PORT) {
      await modifyConfigPort(port)
    }

    // Start fresh Supabase
    try {
      await runCommand('supabase', ['start'], { silent: true })
    } catch (err) {
      if (configWasModified) {
        await restoreConfig()
      }
      throw err
    }

    // Restore config.toml after starting
    if (configWasModified) {
      await restoreConfig()
    }

    // Wait for Postgres to be ready
    for (let i = 0; i < HEALTH_CHECK_RETRIES; i++) {
      if (await commandSucceeds('psql', [destinationUrl, '-c', 'SELECT 1'])) {
        return destinationUrl
      }
      await sleep(HEALTH_CHECK_INTERVAL_MS)
    }

    throw new Error('Postgres failed to become ready')
  },

  async dump(sourceUrl: string, options: DumpOptions): Promise<DumpResult> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const prefix = `dump-${timestamp}`
    const files: string[] = []

    // Dump roles
    const rolesFile = path.join(options.dumpDir, `${prefix}-roles.sql`)
    await runCommand(
      'supabase',
      ['db', 'dump', '--db-url', sourceUrl, '--role-only', '-f', rolesFile],
      { silent: true }
    )
    files.push(rolesFile)

    // Dump schema
    const schemaFile = path.join(options.dumpDir, `${prefix}-schema.sql`)
    await runCommand(
      'supabase',
      ['db', 'dump', '--db-url', sourceUrl, '-f', schemaFile],
      { silent: true }
    )
    files.push(schemaFile)

    // Dump data (unless schema-only)
    if (!options.schemaOnly) {
      const dataFile = path.join(options.dumpDir, `${prefix}-data.sql`)
      await runCommand(
        'supabase',
        [
          'db',
          'dump',
          '--db-url',
          sourceUrl,
          '--data-only',
          '--use-copy',
          '-f',
          dataFile,
        ],
        { silent: true }
      )
      files.push(dataFile)
    }

    return {
      files,
      metadata: {
        hasRoles: true,
        hasData: !options.schemaOnly,
      },
    }
  },

  async restore(
    dumpResult: DumpResult,
    destinationUrl: string,
    options: DumpOptions
  ): Promise<void> {
    const [rolesFile, schemaFile, dataFile] = dumpResult.files

    // Restore roles
    await runCommand('psql', [destinationUrl, '-f', rolesFile], { silent: true })

    // Grant roles to postgres
    await grantRolesToPostgres(destinationUrl)

    // Restore schema
    await runCommand(
      'psql',
      [destinationUrl, '-v', 'ON_ERROR_STOP=1', '-f', schemaFile],
      { silent: true }
    )

    // Restore data (with triggers disabled)
    if (dataFile) {
      await runCommand(
        'psql',
        [
          destinationUrl,
          '-c',
          'SET session_replication_role = replica;',
          '-f',
          dataFile,
          '-c',
          'SET session_replication_role = DEFAULT;',
        ],
        { silent: true }
      )
    }
  },

  async cleanup(): Promise<void> {
    if (configWasModified) {
      await restoreConfig()
    }
  },
}
