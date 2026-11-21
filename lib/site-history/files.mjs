// Which changed files count toward "lines of code", and how routes are read from a file list.

const LOCKFILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|npm-shrinkwrap\.json)$/;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|icns|svg|pdf|woff2?|ttf|otf|eot|onnx|bin|wasm|glb|gltf|stl|step|stp|mp3|wav|ogg|mp4|mov|webm|zip|gz|tar|map|tsbuildinfo)$/i;
// Site data and generated output, not code: uploads and seed data, daily packs, public/ assets.
const GENERATED_DIR = /^(public|seed|daily-packs|\.data|backups|dist|release)\//;
const BIG_JSON_LINES = 300;

/** True when a file's changed lines should count as code. `lines` = added + removed in that commit. */
export function countsAsCode(file, lines = 0) {
  const p = file.replace(/\\/g, '/');
  if (LOCKFILES.test(p) || BINARY_EXT.test(p) || GENERATED_DIR.test(p) || /\.min\.js$/.test(p)) return false;
  // A JSON file that changes by hundreds of lines at once is a data dump, not hand-written code.
  if (/\.json$/i.test(p) && lines > BIG_JSON_LINES) return false;
  return true;
}

/** "src/{a => b}/x.ts" or "a => b" (git's rename notation) -> the new path. */
export function renamedTo(p) {
  if (!p.includes(' => ')) return p;
  const braced = p.replace(/\{([^{}]*) => ([^{}]*)\}/, '$2').replace(/\/\//g, '/');
  return braced.includes(' => ') ? braced.split(' => ')[1] : braced;
}

/** Page routes from a list of repo paths: app/stats/history/page.tsx -> /stats/history. */
export function routesFromPaths(paths) {
  const routes = new Set();
  for (const raw of paths) {
    const m = /^app\/(?:(.*)\/)?page\.(tsx|jsx|ts|js)$/.exec(raw);
    if (!m) continue;
    const segs = (m[1] ?? '').split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'));
    routes.add('/' + segs.join('/'));
  }
  return [...routes].sort();
}
