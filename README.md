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

On first run, `envs init` will offer to set up remote sync via GitHub (if `gh` CLI is installed) or any Git remote. This creates a private `envs-vault` repo that syncs your encrypted vault across machines automatically.

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

### `envs sync`

Enable or run remote vault sync. If remote sync isn't configured yet, walks you through setup. If already configured, pulls then pushes to sync.

```bash
# First time — set up remote sync
$ envs sync
Setting up remote sync...
? Enable remote sync via GitHub? Yes
  Creating private repo HSQ0503/envs-vault...
✓ Remote sync enabled via GitHub
✓ All vault files synced to remote.

# After setup — manual sync
$ envs sync
  Pulling from remote...
  ✓ Synced ↓
  Pushing to remote...
  ✓ Synced ↑
✓ Vault synced.
```

### `envs sync status`

Check the current sync state.

```bash
$ envs sync status
Remote: enabled (GitHub via gh)
Repo:   https://github.com/HSQ0503/envs-vault.git
Status: ✓ in sync (last synced 2 minutes ago)
```

### `envs sync disable`

Disable remote sync without deleting the remote repo.

```bash
$ envs sync disable
✓ Remote sync disabled. Your vault files remain on the remote but will no longer auto-sync.
  To re-enable: envs sync
```

## Remote Sync

`envs` can sync your encrypted vault across machines using Git as the transport layer. Your secrets never leave the encrypted vault — Git only sees `.enc.json` blobs.

### Three-Tier Detection

| Priority | Requirement | What happens |
|----------|------------|--------------|
| Tier 1 | `gh` CLI installed and authenticated | Auto-creates a private `envs-vault` repo on your GitHub |
| Tier 2 | `git` installed | Asks you to paste any private repo URL (GitHub, GitLab, Bitbucket, etc.) |
| Tier 3 | Neither available | Local-only mode (existing behavior) |

### How Sync Works

- **`envs push`** — after encrypting locally, auto-commits and pushes to the remote vault repo
- **`envs pull`** — pulls from remote before decrypting, so you always get the latest
- **Failures are non-blocking** — if the remote is unreachable, local operations still succeed with a warning
- **`envs sync`** — enable remote sync later, or manually retry a failed sync

### New Machine Setup

```bash
# 1. Install envs on the new machine
npm install -g envs-cli

# 2. Init in any project directory — envs detects your existing vault repo
envs init
# → Found envs-vault on GitHub, cloning...
# → ✓ Vault synced from GitHub

# 3. Pull your env files
envs pull
# → ✓ Pulled 12 variables → .env
```

## How It Works

### Vault Structure

```
~/.envs/
├── config.json              # master salt, password hash, remote config
├── auth.json                # cached derived key (24h TTL)
└── vault/                   # ← this is the git repo (when sync enabled)
    ├── prj_a8f3c2d1.enc.json   # encrypted project data
    └── prj_b7e4f1a9.enc.json
```

`config.json` and `auth.json` live outside the vault directory and are never synced. Only encrypted `.enc.json` files are pushed to the remote.

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
┌─────────────┐     envs push     ┌──────────────────┐     git push     ┌─────────────────┐
│  Project A   │ ───────────────→  │   ~/.envs/vault/  │ ─────────────→  │  Remote Git Repo │
│  .env        │                   │   (encrypted)     │                 │  (private)       │
│  .env.prod   │ ←───────────────  │                   │ ←─────────────  │                  │
└─────────────┘     envs pull      └──────────────────┘     git pull     └─────────────────┘
                                          ↑                                      ↑
┌─────────────┐     envs push             │                                      │
│  Project B   │ ─────────────────────────→│          ┌──────────────────┐        │
│  .env        │ ←─────────────────────────│          │  Another Machine │ ←──────│
└─────────────┘     envs pull              │          │  ~/.envs/vault/  │ ──────→│
                                           │          └──────────────────┘
```

## Security Notes

- Your master password never touches disk — only the PBKDF2-derived key hash is stored
- Each vault file is independently encrypted with a unique IV
- The auth cache expires after 24 hours and is encrypted with your machine identity
- `.env` files are automatically added to `.gitignore` during init
- `.envs.json` contains only metadata (project ID, environment names, file paths) — no secrets

## License

MIT
