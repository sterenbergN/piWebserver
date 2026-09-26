#!/usr/bin/env bash
# Deploy noahstuf.com on the Raspberry Pi from a GitHub release.
#
#   deploy.sh                 install the latest release (no-op if already running it)
#   deploy.sh <release-tag>   install a specific release, e.g. build-20260926-1a2b3c4
#   deploy.sh --check         say whether an update is available
#   deploy.sh --status        show the running build and installed releases
#   deploy.sh --rollback      switch back to the previous release
#   deploy.sh --migrate <old-app-folder>
#                             one-time: copy data from the old install into shared/
#
# Layout (all under APP_DIR, e.g. on the site USB):
#   releases/<tag>/   one folder per build (code only; nothing to back up)
#   current -> releases/<tag>   what pm2 runs
#   shared/           site data kept across updates: data/, uploads/, content/,
#                     cache/, backups/, env (KEY=value lines, e.g. PI_DASHBOARD_PASSWORD)
#
# Safety: downloads over HTTPS from GitHub, checks the SHA-256 published with
# the release (and GitHub's build attestation when the `gh` CLI is installed),
# switches with an atomic symlink swap, health-checks the new build and
# automatically rolls back if it doesn't come up. Data is never inside a
# release, so an update can't overwrite it.
set -euo pipefail

REPO="${REPO:-sterenbergN/piWebserver}"
PM2_NAME="${PM2_NAME:-noahstuf}"
PORT="${PORT:-3000}"
KEEP="${KEEP_RELEASES:-3}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"

# Site folder: $APP_DIR if set, else where this script lives (APP_DIR/deploy.sh,
# or APP_DIR/releases/<tag>/deploy.sh inside a release).
if [[ -z "${APP_DIR:-}" ]]; then
  here="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
  if [[ "$(basename "$(dirname "$here")")" == "releases" ]]; then APP_DIR="$(dirname "$(dirname "$here")")"; else APP_DIR="$here"; fi
fi
[[ -d "$APP_DIR" && -w "$APP_DIR" ]] || { echo "APP_DIR '$APP_DIR' is not a writable folder" >&2; exit 1; }

RELEASES="$APP_DIR/releases"
SHARED="$APP_DIR/shared"
CURRENT="$APP_DIR/current"
TMP="$APP_DIR/.deploy-tmp"
API="${RELEASE_API:-https://api.github.com/repos/$REPO/releases}"

log() { printf '[deploy %s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { log "ERROR: $*"; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not installed"; }

need curl; need tar; need sha256sum; need node

json_field() { # json_field <file> <js expression on `r`>
  node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); const v=($2); if (v===undefined||v===null) process.exit(2); console.log(v)" "$1"
}

running_build() {
  curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).build||'')}catch{console.log('')}})" || true
}

current_tag() { [[ -L "$CURRENT" ]] && basename "$(readlink -f "$CURRENT")" || echo ""; }

fetch_release() { # fetch_release <tag|latest> <out.json>
  local url="$API/latest"
  [[ "$1" != "latest" ]] && url="$API/tags/$1"
  curl -fsSL -H 'Accept: application/vnd.github+json' ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} "$url" -o "$2" \
    || die "could not read release '$1' from GitHub"
}

write_ecosystem() {
  # pm2 runs current/server.js with the env from shared/env.
  cat > "$APP_DIR/ecosystem.config.cjs" <<EOF
const fs = require('fs');
const path = require('path');
const envFile = path.join(__dirname, 'shared', 'env');
const env = { NODE_ENV: 'production', PORT: '$PORT', HOSTNAME: '0.0.0.0' };
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '\$2');
  }
}
module.exports = { apps: [{ name: '$PM2_NAME', cwd: path.join(__dirname, 'current'), script: 'server.js', env, max_memory_restart: '700M', time: true }] };
EOF
}

link_shared() { # link_shared <release-dir>
  local rel="$1"
  mkdir -p "$SHARED"/{data,uploads,content,cache,backups}
  # First install: seed default JSON files, never overwriting existing data.
  if [[ -d "$rel/seed" ]]; then
    (cd "$rel/seed" && find . -type f) | while read -r f; do
      f="${f#./}"
      [[ -e "$SHARED/$f" ]] || { mkdir -p "$(dirname "$SHARED/$f")"; cp "$rel/seed/$f" "$SHARED/$f"; }
    done
  fi
  rm -rf "$rel/.data" "$rel/public/uploads" "$rel/public/content" "$rel/.cache" "$rel/backups"
  ln -s "$SHARED/data" "$rel/.data"
  ln -s "$SHARED/uploads" "$rel/public/uploads"
  ln -s "$SHARED/content" "$rel/public/content"
  ln -s "$SHARED/cache" "$rel/.cache"
  ln -s "$SHARED/backups" "$rel/backups"
}

switch_to() { # atomic symlink swap
  ln -sfn "$1" "$APP_DIR/.current.tmp"
  mv -Tf "$APP_DIR/.current.tmp" "$CURRENT"
}

restart_app() {
  need pm2
  write_ecosystem
  # A plain reload can keep the old resolved path of the `current` symlink, so
  # restart cleanly (a few seconds of downtime) to be sure the new build runs.
  # 9>&- : don't let pm2 (or the app it starts) inherit the deploy lock.
  pm2 delete "$PM2_NAME" >/dev/null 2>&1 9>&- || true
  pm2 start "$APP_DIR/ecosystem.config.cjs" --update-env >/dev/null 9>&-
  pm2 save >/dev/null 2>&1 9>&- || true
}

wait_healthy() { # wait_healthy <expected-build>
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  while (( SECONDS < deadline )); do
    [[ "$(running_build)" == "$1" ]] && return 0
    sleep 2
  done
  return 1
}

prune() {
  local keep_now; keep_now="$(current_tag)"
  ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r dir; do
    [[ "$(basename "$dir")" == "$keep_now" ]] && continue
    rm -rf "$dir"
  done
}

cmd="${1:-latest}"
mkdir -p "$RELEASES" "$SHARED"

case "$cmd" in
  --status)
    echo "Site folder:     $APP_DIR"
    echo "Current release: $(current_tag || true)"
    echo "Running build:   $(running_build)"
    echo "Installed:"; ls -1t "$RELEASES" 2>/dev/null | sed 's/^/  /'
    exit 0 ;;

  --check)
    mkdir -p "$TMP"; fetch_release latest "$TMP/release.json"
    latest="$(json_field "$TMP/release.json" 'r.tag_name')"
    [[ "$latest" == "$(current_tag)" ]] && echo "Up to date ($latest)" || echo "Update available: $(current_tag || echo none) -> $latest"
    exit 0 ;;

  --rollback)
    now="$(current_tag)"
    prev="$(ls -1t "$RELEASES" | grep -vx "$now" | head -n1 || true)"
    [[ -n "$prev" ]] || die "no previous release to roll back to"
    log "Rolling back $now -> $prev"
    switch_to "$RELEASES/$prev"; restart_app
    wait_healthy "$(json_field "$RELEASES/$prev/build-info.json" 'r.id')" && log "Rolled back to $prev" || die "previous release did not come up either"
    exit 0 ;;

  --migrate)
    old="${2:-}"; [[ -d "$old" ]] || die "usage: deploy.sh --migrate <old-app-folder>"
    mkdir -p "$SHARED"/{data,uploads,content}
    [[ -d "$old/.data" ]] && cp -a "$old/.data/." "$SHARED/data/"
    [[ -d "$old/public/uploads" ]] && cp -a "$old/public/uploads/." "$SHARED/uploads/"
    [[ -d "$old/public/content" ]] && cp -a "$old/public/content/." "$SHARED/content/"
    for f in "$old"/.env "$old"/.env.local "$old"/.env.production; do
      [[ -f "$f" ]] && grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$f" >> "$SHARED/env" || true
    done
    log "Copied data from $old into $SHARED (the old folder is untouched). Now run: deploy.sh"
    exit 0 ;;
esac

# ── Install a release ──────────────────────────────────────────────────────────
[[ "$(uname -m)" == "aarch64" ]] || log "warning: builds are made for 64-bit Pi OS (aarch64); this is $(uname -m)"
exec 9>"$APP_DIR/.deploy.lock"; flock -n 9 || die "another deploy is already running"

rm -rf "$TMP"; mkdir -p "$TMP"
fetch_release "${cmd#--}" "$TMP/release.json"
tag="$(json_field "$TMP/release.json" 'r.tag_name')"
[[ "$tag" =~ ^[A-Za-z0-9._-]+$ ]] || die "unexpected release tag '$tag'"
if [[ "$tag" == "$(current_tag)" && "$(running_build)" != "" ]]; then log "Already running $tag"; exit 0; fi

tar_url="$(json_field "$TMP/release.json" 'r.assets.find(a=>a.name.endsWith(".tar.gz")).browser_download_url')" || die "release has no .tar.gz"
sum_url="$(json_field "$TMP/release.json" 'r.assets.find(a=>a.name.endsWith(".tar.gz.sha256")).browser_download_url')" || die "release has no .sha256"
tar_name="$(basename "$tar_url")"

log "Downloading $tag ($tar_name)"
curl -fsSL --retry 3 -o "$TMP/$tar_name" "$tar_url"
curl -fsSL --retry 3 -o "$TMP/$tar_name.sha256" "$sum_url"
(cd "$TMP" && sha256sum -c "$tar_name.sha256" >/dev/null) || die "checksum mismatch — download discarded"
log "Checksum OK"
if command -v gh >/dev/null 2>&1; then
  gh attestation verify "$TMP/$tar_name" --repo "$REPO" >/dev/null 2>&1 && log "Build attestation verified (built by GitHub Actions from $REPO)" \
    || die "build attestation check failed — not installing"
fi

dest="$RELEASES/$tag"
rm -rf "$dest.partial"; mkdir -p "$dest.partial"
tar -xzf "$TMP/$tar_name" -C "$dest.partial"
[[ -f "$dest.partial/server.js" && -f "$dest.partial/build-info.json" ]] || die "release is missing server.js"
link_shared "$dest.partial"
rm -rf "$dest"; mv "$dest.partial" "$dest"
build_id="$(json_field "$dest/build-info.json" 'r.id')"

previous="$(current_tag)"
log "Switching ${previous:-(none)} -> $tag"
switch_to "$dest"
restart_app

if wait_healthy "$build_id"; then
  log "✔ $tag is live"
  cp "$dest/deploy.sh" "$APP_DIR/deploy.sh" 2>/dev/null && chmod +x "$APP_DIR/deploy.sh" || true
  prune
  rm -rf "$TMP"
else
  log "New build did not become healthy within ${HEALTH_TIMEOUT}s"
  if [[ -n "$previous" && -d "$RELEASES/$previous" ]]; then
    switch_to "$RELEASES/$previous"; restart_app
    if wait_healthy "$(json_field "$RELEASES/$previous/build-info.json" 'r.id')"; then log "Rolled back to $previous — site is up"; else log "Rolled back to $previous but it is not answering yet"; fi
  fi
  rm -rf "$dest"   # drop the failed build so it isn't picked for a rollback
  pm2 logs "$PM2_NAME" --lines 30 --nostream 2>/dev/null || true
  exit 1
fi
