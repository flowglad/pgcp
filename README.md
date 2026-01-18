# pgcp

PostgreSQL Copy Tool - Copy databases like `cp` copies files.

```bash
pgcp env:STAGING_DATABASE_URL
```

## Installation

```bash
npm install -g pgcp
```

## Usage

```bash
pgcp <source> [port]
```

### Arguments

- `<source>` - Source database URL or `env:VARNAME` to read from .env files
- `[port]` - Local Supabase port (default: 54322)

### Options

- `--schema-only, -s` - Copy schema only, skip data
- `--keep-dumps, -k` - Keep dump files after completion
- `--help, -h` - Show help message

### Examples

```bash
# Copy using env variable from .env.local
pgcp env:STAGING_DATABASE_URL

# Copy to a custom port
pgcp env:STAGING_DATABASE_URL 54400

# Copy schema only (no data)
pgcp --schema-only env:PROD_DATABASE_URL
```

## Environment

Automatically loads `.env` and `.env.local` from the current directory. Use the `env:VARNAME` syntax to reference variables from these files.

## Requirements

- **Docker** (running)
- **Supabase CLI** (`brew install supabase/tap/supabase`)
- **psql** (for role grants)
- **Node.js** >= 18

## How It Works

1. Checks prerequisites (Docker, Supabase CLI, psql)
2. Stops existing local Supabase
3. Starts fresh local Supabase
4. Waits for Postgres readiness
5. Dumps from source: roles → schema → data (optional)
6. Restores to local: roles → grant roles → schema → data (triggers disabled)
7. Cleans up dump files (unless `--keep-dumps`)

## Limitations

- v0.1.0 only supports **Supabase** as the source
- Destination is always local Supabase (Docker)
- macOS only

## License

MIT
