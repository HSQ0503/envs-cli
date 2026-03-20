# envs-cli

Encrypted vault for your `.env` files. Push, pull, and sync environment variables across machines.

Stop losing `.env` files. Stop sharing them over Slack. `envs` encrypts your environment variables with AES-256-GCM and stores them in a local vault at `~/.envs/`. Clone a project on a new machine, run `envs pull`, and you're ready to go.

## Install

```bash
npm install -g envs-cli
```

## Quick Start

```bash
# Initialize in your project directory
cd my-project
envs init

# Push your .env files to the encrypted vault
envs push

# On another machine, clone the repo and pull
envs pull
```

## Commands

### `envs init`

Initialize the vault for the current project.

- Creates a master password on first use (stored as a PBKDF2-derived hash, never plaintext)
- Scans for `.env*` files and maps them to environments
- Creates `.envs.json` in the project root (safe to commit — contains no secrets)
- Adds `.env*` to `.gitignore` automatically
- Encrypts and stores all mapped env files in the vault

```bash
$ envs init
? Create master password: ********
? Confirm master password: ********
✓ Master password set.
? Project name: my-saas-app
? .env → Map to "development" environment
? .env.production → Map to "production" environment
  ✓ .env → development (12 variables)
  ✓ .env.production → production (8 variables)
✓ Initialized envs vault
```

### `envs push`

Encrypt and push local env files to the vault.

```bash
$ envs push
✓ Pushed 12 variables (development)
✓ Pushed 8 variables (production)
```

### `envs pull`

Pull and decrypt env files from the vault. If a local file already exists, you'll be prompted to overwrite or skip.

```bash
$ envs pull
✓ Pulled 12 variables → .env
✓ Pulled 8 variables → .env.production
```

### `envs diff`

Compare local env files against what's stored in the vault.

```bash
$ envs diff
─── development (.env) ───
  ⚠ API_KEY
    local: sk****23
    vault: sk****89
  ⚠ Only local: NEW_VAR

  ✓ 11 in sync
  ⚠ 1 only local
  ⚠ 1 different values
```

Use `--reveal` to show full plaintext values instead of masked.

```bash
$ envs diff --reveal
```

### `envs list`

List all projects stored in the vault.

```bash
$ envs list
Project                  Environments             Variables
────────────────────────────────────────────────────────────
my-saas-app              development, production  20
side-project             development              5
```

### `envs env list`

Show environment mappings for the current project.

```bash
$ envs env list
Environments for my-saas-app:

  development → .env
  production → .env.production

  Ignored: .env.local
```

### `envs env add <name>`

Add a new environment to the current project.

```bash
$ envs env add staging
? File for "staging" environment: .env.staging
✓ Added environment "staging" → .env.staging
```

## How It Works

### Vault Structure

```
~/.envs/
├── config.json              # master salt + password verification hash
├── vault/
│   ├── prj_a8f3c2d1.enc.json   # encrypted project data
│   └── prj_b7e4f1a9.enc.json
└── auth.json                # cached derived key (24h TTL)
```

### Project Config (`.envs.json`)

Created in your project root and safe to commit. Contains no secrets.

```json
{
  "projectId": "prj_a8f3c2d1",
  "projectName": "my-saas-app",
  "environments": {
    "development": ".env",
    "production": ".env.production"
  },
  "ignore": [".env.local"]
}
```

### Encryption

- **Algorithm:** AES-256-GCM (authenticated encryption)
- **Key derivation:** PBKDF2 with SHA-512, 100,000 iterations, 32-byte random salt
- **Each encryption** uses a unique 16-byte IV
- **Password** is never stored — only a verification hash of the derived key
- **Auth cache** is encrypted with a machine-specific identifier (hostname + username + platform)

### .env Parsing

Handles standard `.env` formats:

```bash
# Comments are preserved
DATABASE_URL=postgres://localhost:5432/mydb
API_KEY=sk_test_abc123
QUOTED_VALUE="hello world"
SINGLE_QUOTED='single quotes'
EMPTY_VAR=
MULTILINE="line one
line two"
```

## Workflow

```
┌─────────────┐     envs push     ┌──────────────────┐
│  Project A   │ ───────────────→  │   ~/.envs/vault/  │
│  .env        │                   │   (encrypted)     │
│  .env.prod   │ ←───────────────  │                   │
└─────────────┘     envs pull      └──────────────────┘
                                          ↑
┌─────────────┐     envs push             │
│  Project B   │ ─────────────────────────→│
│  .env        │ ←─────────────────────────│
└─────────────┘     envs pull
```

## Security Notes

- Your master password never touches disk — only the PBKDF2-derived key hash is stored
- Each vault file is independently encrypted with a unique IV
- The auth cache expires after 24 hours and is encrypted with your machine identity
- `.env` files are automatically added to `.gitignore` during init
- `.envs.json` contains only metadata (project ID, environment names, file paths) — no secrets

## License

MIT
