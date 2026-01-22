/**
 * Vanilla PostgreSQL provider
 *
 * Uses pg_dump/psql for any standard PostgreSQL database.
 */

import fs from 'fs/promises'
import path from 'path'
import type { Provider, DumpResult, DumpOptions } from '../../types.js'
import { runCommand } from '../../utils/commands.js'

export const VanillaPostgresProvider: Provider = {
  id: 'postgres',
  name: 'PostgreSQL',
  flag: null, // Default provider, no flag needed
  prerequisites: ['pg_dump', 'psql'],
  managesDestination: false,

  async dump(sourceUrl: string, options: DumpOptions): Promise<DumpResult> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dumpFile = path.join(options.dumpDir, `dump-${timestamp}.sql`)

    const pgDumpArgs = ['--no-owner', '--no-acl', '-f', dumpFile]

    if (options.schemaOnly) {
      pgDumpArgs.push('--schema-only')
    }

    pgDumpArgs.push(sourceUrl)

    await runCommand('pg_dump', pgDumpArgs, { silent: true })

    return {
      files: [dumpFile],
    }
  },

  async restore(
    dumpResult: DumpResult,
    destinationUrl: string,
    _options: DumpOptions
  ): Promise<void> {
    const [dumpFile] = dumpResult.files

    await runCommand('psql', [destinationUrl, '-f', dumpFile], { silent: true })
  },
}
