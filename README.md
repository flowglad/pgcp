# pgcp

PostgreSQL Copy Tool - Copy databases like `cp` copies files.

```bash
npx pgcp <source_url> <destination_url>
```

## Installation

```bash
# Run directly without installing
npx pgcp <source> <destination>

# Or install globally
npm install -g pgcp
```

## Usage

```bash
# Default mode: copy between any postgres databases
pgcp <source> <destination>

# Supabase mode: copy to local Supabase
pgcp --supabase <source> [port]
```

### Arguments

- `<source>` - Source database URL or `env:VARNAME`
- `<destination>` - Destination database URL or `env:VARNAME`

### Options

- `--supabase` - Use Supabase mode (destination is local Supabase, managed automatically)
- `--schema-only, -s` - Copy schema only, skip data
- `--keep-dumps, -k` - Keep dump files after completion
- `--help, -h` - Show help message

### Examples

```bash
# Copy from remote postgres to local postgres
npx pgcp postgres://user:pass@remote:5432/prod postgresql://localhost:5433/local

# Use env variables from .env.local
npx pgcp env:PROD_DATABASE_URL env:LOCAL_DATABASE_URL

# Copy schema only (no data)
npx pgcp --schema-only env:PROD_DB env:LOCAL_DB

# Supabase mode: copy Supabase DB to local Supabase (automatic setup)
npx pgcp --supabase env:SUPABASE_DATABASE_URL
npx pgcp --supabase env:SUPABASE_DATABASE_URL 54400  # custom port
```

## Environment

Automatically loads `.env` and `.env.local` from the current directory. Use the `env:VARNAME` syntax to reference variables from these files.

## Requirements

### Default mode

- **pg_dump** (`brew install libpq && brew link --force libpq`)
- **psql**
- **Node.js** >= 18

### Supabase mode (--supabase)

- **Docker** (running)
- **Supabase CLI** (`brew install supabase/tap/supabase`)
- **psql**
- **Node.js** >= 18

## How It Works

### Default mode

1. Checks prerequisites (pg_dump, psql)
2. Verifies destination database is accessible
3. Dumps source database using pg_dump
4. Restores to destination using psql
5. Cleans up dump files (unless `--keep-dumps`)

### Supabase mode

1. Checks prerequisites (Docker, Supabase CLI, psql)
2. Stops existing local Supabase
3. Starts fresh local Supabase
4. Waits for Postgres readiness
5. Dumps from source: roles -> schema -> data (optional)
6. Restores to local: roles -> grant roles -> schema -> data (triggers disabled)
7. Cleans up dump files (unless `--keep-dumps`)

## License

MIT
