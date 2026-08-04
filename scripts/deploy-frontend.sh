#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

PUBLISH_PATH="/var/www/b5d-angular/current"
BACKUP_PATH="/var/backups/b5d-angular"
DIST_BROWSER_PATH="$REPO_ROOT/dist/frontend/browser"
VERSION=""
DESCRIPTION="Build automatizado"
SKIP_BUILD=0

usage() {
  cat <<'EOF'
Usage: deploy-frontend.sh [options]

Options:
  --publish-path PATH       Destination folder served by Nginx
  --backup-path PATH        Folder where previous versions are archived
  --browser-dist-path PATH  Angular browser dist folder
  --version VERSION         Version label to store in the backup name
  --description TEXT        Description to store alongside the publish
  --skip-build              Skip npm run build and publish the existing dist
  -h, --help                Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish-path)
      PUBLISH_PATH="$2"
      shift 2
      ;;
    --backup-path)
      BACKUP_PATH="$2"
      shift 2
      ;;
    --browser-dist-path)
      DIST_BROWSER_PATH="$2"
      shift 2
      ;;
    --version)
      VERSION="$2"
      shift 2
      ;;
    --description|--desccription)
      DESCRIPTION="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

resolve_path() {
  local path="$1"
  if [[ "$path" = /* ]]; then
    printf '%s\n' "$path"
  else
    printf '%s\n' "$(cd -- "$(dirname -- "$path")" && pwd)/$(basename -- "$path")"
  fi
}

ensure_directory() {
  mkdir -p "$1"
}

resolve_npm_command() {
  local candidate
  for candidate in \
    /usr/local/bin/npm \
    /usr/bin/npm \
    /bin/npm \
    /home/*/.nvm/versions/node/*/bin/npm \
    /root/.nvm/versions/node/*/bin/npm
  do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

PUBLISH_PATH="$(resolve_path "$PUBLISH_PATH")"
BACKUP_PATH="$(resolve_path "$BACKUP_PATH")"
DIST_BROWSER_PATH="$(resolve_path "$DIST_BROWSER_PATH")"

ensure_directory "$PUBLISH_PATH"
ensure_directory "$BACKUP_PATH"

NPM_COMMAND=""
NPM_BIN_DIR=""
if [[ "$SKIP_BUILD" -eq 0 ]]; then
  NPM_COMMAND="$(resolve_npm_command || true)"
  if [[ -z "$NPM_COMMAND" ]]; then
    echo "npm command not found. Install Node.js or expose npm in PATH." >&2
    exit 127
  fi
  NPM_BIN_DIR="$(cd -- "$(dirname -- "$NPM_COMMAND")" && pwd)"
  export PATH="$NPM_BIN_DIR:$PATH"
fi

if [[ -z "$VERSION" ]]; then
  if git -C "$REPO_ROOT" rev-parse --short HEAD >/dev/null 2>&1; then
    VERSION="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  else
    VERSION="$(date -u +%Y%m%d%H%M%S)"
  fi
fi

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo '==> Building Angular app (npm run build)...'
  (cd "$REPO_ROOT" && "$NPM_COMMAND" run build)
fi

if [[ ! -d "$DIST_BROWSER_PATH" ]]; then
  echo "Browser dist path not found: $DIST_BROWSER_PATH" >&2
  exit 1
fi

if find "$PUBLISH_PATH" -mindepth 1 -maxdepth 1 | read -r _; then
  backup_tar="$BACKUP_PATH/b5d-angular-$VERSION.tar.gz"
  if [[ -e "$backup_tar" ]]; then
    echo "Backup archive already exists: $backup_tar" >&2
    exit 1
  fi

  echo "==> Creating backup archive: $backup_tar"
  tar -czf "$backup_tar" -C "$PUBLISH_PATH" .
fi

echo "==> Publishing browser dist to: $PUBLISH_PATH"
find "$PUBLISH_PATH" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

if command -v rsync >/dev/null 2>&1; then
  rsync -a "$DIST_BROWSER_PATH"/ "$PUBLISH_PATH"/
else
  cp -a "$DIST_BROWSER_PATH"/. "$PUBLISH_PATH"/
fi

publish_info="$PUBLISH_PATH/app-version.txt"
{
  echo "version=$VERSION"
  echo "deployedAtUtc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "description=$DESCRIPTION"
} > "$publish_info"

echo
echo "Deployment completed."
echo "Version: $VERSION"
echo "Published folder: $PUBLISH_PATH"
echo "Backup folder: $BACKUP_PATH"
