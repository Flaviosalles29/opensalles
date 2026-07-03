#!/usr/bin/env bash
set -euo pipefail

on_error() {
  echo "A2UI bundling failed. Re-run with: pnpm canvas:a2ui:bundle" >&2
  echo "If this persists, verify pnpm deps and try again." >&2
}
trap on_error ERR

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HASH_FILE="$ROOT_DIR/src/canvas-host/a2ui/.bundle.hash"
OUTPUT_FILE="$ROOT_DIR/src/canvas-host/a2ui/a2ui.bundle.js"
A2UI_RENDERER_DIR="$ROOT_DIR/vendor/a2ui/renderers/lit"
A2UI_APP_DIR="$ROOT_DIR/apps/shared/OpenClawKit/Tools/CanvasA2UI"

# Docker builds exclude vendor/apps via .dockerignore.
# In that environment we can keep a prebuilt bundle only if it exists.
if [[ ! -d "$A2UI_RENDERER_DIR" || ! -d "$A2UI_APP_DIR" ]]; then
  if [[ -f "$OUTPUT_FILE" ]]; then
    echo "A2UI sources missing; keeping prebuilt bundle."
    exit 0
  fi
  echo "A2UI sources missing and no prebuilt bundle found at: $OUTPUT_FILE" >&2
  exit 1
fi

INPUT_PATHS=(
  "package.json"
  "pnpm-lock.yaml"
  "vendor/a2ui/renderers/lit"
  "apps/shared/OpenClawKit/Tools/CanvasA2UI"
)

ensure_node_on_path() {
  if command -v node >/dev/null 2>&1; then
    return
  fi
  local node_exe="${OPENCLAW_NODE_EXE:-}"
  if [[ -z "$node_exe" ]] && command -v node.exe >/dev/null 2>&1; then
    node_exe="$(command -v node.exe)"
  fi
  if [[ -z "$node_exe" || ! -f "$node_exe" ]]; then
    return
  fi

  local shim_dir="$ROOT_DIR/.tmp/node-shim"
  mkdir -p "$shim_dir"
  cat >"$shim_dir/node" <<'SH'
#!/usr/bin/env bash
exec "$OPENCLAW_NODE_SHIM_TARGET" "$@"
SH
  chmod +x "$shim_dir/node"
  export OPENCLAW_NODE_SHIM_TARGET="$node_exe"
  export PATH="$shim_dir:$PATH"
}

run_node() {
  ensure_node_on_path
  if command -v node >/dev/null 2>&1; then
    node "$@"
    return
  fi
  pnpm exec node "$@"
}

run_pnpm() {
  ensure_node_on_path
  if [[ -n "${OPENCLAW_NODE_EXE:-}" && -n "${OPENCLAW_PNPM_CLI:-}" ]]; then
    "$OPENCLAW_NODE_EXE" "$OPENCLAW_PNPM_CLI" "$@"
    return
  fi
  if command -v pnpm.cmd >/dev/null 2>&1; then
    cmd.exe /d /s /c "pnpm.cmd $*"
    return
  fi
  pnpm "$@"
}

compute_hash() {
  (
    cd "$ROOT_DIR"
    run_node --input-type=module - "${INPUT_PATHS[@]}" <<'NODE'
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const rootDir = process.env.ROOT_DIR ?? process.cwd();
const inputs = process.argv.slice(2);
const files = [];

async function walk(entryPath) {
  const st = await fs.stat(entryPath);
  if (st.isDirectory()) {
    const entries = await fs.readdir(entryPath);
    for (const entry of entries) {
      await walk(path.join(entryPath, entry));
    }
    return;
  }
  files.push(entryPath);
}

for (const input of inputs) {
  await walk(input);
}

function normalize(p) {
  return p.split(path.sep).join("/");
}

files.sort((a, b) => normalize(a).localeCompare(normalize(b)));

const hash = createHash("sha256");
for (const filePath of files) {
  const rel = normalize(path.relative(rootDir, filePath));
  hash.update(rel);
  hash.update("\0");
  hash.update(await fs.readFile(filePath));
  hash.update("\0");
}

process.stdout.write(hash.digest("hex"));
NODE
  )
}

ensure_node_on_path
current_hash="$(compute_hash)"
if [[ -f "$HASH_FILE" ]]; then
  previous_hash="$(cat "$HASH_FILE")"
  if [[ "$previous_hash" == "$current_hash" && -f "$OUTPUT_FILE" ]]; then
    echo "A2UI bundle up to date; skipping."
    exit 0
  fi
fi

run_pnpm -s exec tsc -p "vendor/a2ui/renderers/lit/tsconfig.json"
run_pnpm -s dlx rolldown -c "apps/shared/OpenClawKit/Tools/CanvasA2UI/rolldown.config.mjs"

echo "$current_hash" > "$HASH_FILE"
