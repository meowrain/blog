import path from 'path';

export const CATEGORY_DISPLAY_SEPARATOR = ' > ';

/** Collapse `\`, `>` and repeated `/` into a clean `a/b/c` category path. */
export function normalizeCategoryPath(input?: string | null): string {
  if (!input) {
    return '';
  }
  return input
    .replace(/>/g, '/')
    .replace(/[\\/]+/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join('/');
}

/** `a/b` -> `a > b`, the form stored in frontmatter and shown in the UI. */
export function toDisplayCategory(input?: string | null): string {
  const normalized = normalizeCategoryPath(input);
  return normalized ? normalized.split('/').join(CATEGORY_DISPLAY_SEPARATOR) : '';
}

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

export function toOsPath(p: string): string {
  return p.replace(/\//g, path.sep);
}

/** Directory portion of a POSTS_DIR-relative file path, as a posix category path. */
export function categoryOf(relativePath: string): string {
  const dir = toPosix(path.dirname(relativePath));
  return dir === '.' ? '' : dir;
}

/** True when `dir` is the parent of, or an ancestor parent of, `relativePath`. */
export function isInCategory(relativePath: string, dir: string): boolean {
  const category = categoryOf(relativePath);
  const target = normalizeCategoryPath(dir);
  if (target === '') {
    return true;
  }
  return category === target || category.startsWith(target + '/');
}

/**
 * Replace a leading path segment sequence, anchored at the start of the path.
 *
 * The plain `String.replace` this replaces was unanchored: an article at
 * `frontend/Bar/x.md` renamed out of category `Bar` rewrote the *first*
 * occurrence of `Bar`, which lived inside `frontend`, corrupting the path.
 * Returns the input untouched when `oldPrefix` is not a real directory prefix.
 */
export function replacePathPrefix(
  relativePath: string,
  oldPrefix: string,
  newPrefix: string,
): string {
  const target = toPosix(relativePath);
  const from = normalizeCategoryPath(oldPrefix);
  const to = normalizeCategoryPath(newPrefix);

  if (from === '') {
    return relativePath;
  }
  if (target !== from && !target.startsWith(from + '/')) {
    return relativePath;
  }

  const rest = target.slice(from.length).replace(/^\/+/, '');
  return to === '' ? rest : `${to}/${rest}`;
}

/**
 * Collapse a wildcard route parameter back into one relative path.
 *
 * Express 5 reports a named wildcard (`*path`) as an array of segments, so the
 * default string coercion turned `Java/JUC/x.md` into `Java,JUC,x.md` and every
 * nested article 404'd. A single `%2F`-encoded segment (what the admin UI sends)
 * arrives as a one-element array and still round-trips unchanged.
 */
export function wildcardParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value.join('/');
  }
  return value ?? '';
}
