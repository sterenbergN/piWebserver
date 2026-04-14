import path from 'path';

const publicRoot = path.resolve(process.cwd(), 'public');

function normalizeCandidate(candidate: string) {
  return candidate.replace(/^\/+/, '');
}

export function resolvePathInside(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(resolvedRoot, normalizeCandidate(candidate));
  if (resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    return resolvedCandidate;
  }
  return null;
}

export function toPublicRelativePath(src: string) {
  const withoutMediaPrefix = src.replace(/^\/api\/media/, '');
  return withoutMediaPrefix.startsWith('/') ? withoutMediaPrefix.slice(1) : withoutMediaPrefix;
}

export function resolvePublicPath(src: string) {
  return resolvePathInside(publicRoot, toPublicRelativePath(src));
}

export function isSafeBlogSlug(slug: string) {
  return /^[a-z0-9-]+$/.test(slug);
}
