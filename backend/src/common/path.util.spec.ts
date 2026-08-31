import {
  isInCategory,
  normalizeCategoryPath,
  replacePathPrefix,
  toDisplayCategory,
  categoryOf,
  wildcardParam,
} from './path.util';

describe('normalizeCategoryPath', () => {
  it('folds separators and stray whitespace into a posix path', () => {
    expect(normalizeCategoryPath(' Java \\ Spring / ')).toBe('Java/Spring');
    expect(normalizeCategoryPath('Java > Spring')).toBe('Java/Spring');
    expect(normalizeCategoryPath('///Java////Spring///')).toBe('Java/Spring');
  });

  it('maps empty-ish input to the root', () => {
    expect(normalizeCategoryPath('')).toBe('');
    expect(normalizeCategoryPath(undefined)).toBe('');
    expect(normalizeCategoryPath('   /   ')).toBe('');
  });
});

describe('toDisplayCategory', () => {
  it('renders a path with the display separator', () => {
    expect(toDisplayCategory('java/spring')).toBe('java > spring');
    expect(toDisplayCategory('')).toBe('');
  });
});

describe('categoryOf', () => {
  it('is the directory of the file, empty at the root', () => {
    expect(categoryOf('Java/Spring/Article.md')).toBe('Java/Spring');
    expect(categoryOf('Article.md')).toBe('');
  });
});

describe('isInCategory', () => {
  it('matches the category itself and its descendants only', () => {
    expect(isInCategory('Java/Spring/Article.md', 'Java/Spring')).toBe(true);
    expect(isInCategory('Java/Spring/Extra/Article.md', 'Java')).toBe(true);
    expect(isInCategory('JavaScript/Article.md', 'Java')).toBe(false);
    expect(isInCategory('Java/Spring/Article.md', '')).toBe(true);
  });
});

describe('replacePathPrefix', () => {
  it('rewrites a nested category subtree', () => {
    expect(replacePathPrefix('Java/Spring/Article.md', 'Java/Spring', 'Kotlin/Ktor')).toBe(
      'Kotlin/Ktor/Article.md',
    );
  });

  it('is anchored, so a segment that only appears mid-path is left alone', () => {
    // The unanchored String.replace this replaces turned this into
    // "frontend/Kotlin/Ktor/Bar.md".
    expect(replacePathPrefix('frontend/Bar/Article.md', 'Bar', 'Kotlin')).toBe(
      'frontend/Bar/Article.md',
    );
  });

  it('moves an article out when the new prefix is the root', () => {
    expect(replacePathPrefix('Java/Spring/Article.md', 'Java', '')).toBe('Spring/Article.md');
    expect(replacePathPrefix('Java/Article.md', 'Java', '')).toBe('Article.md');
  });

  it('matches the prefix case-sensitively, so casing stays as the author wrote it', () => {
    expect(replacePathPrefix('java/Article.md', 'Java', 'Kotlin')).toBe('java/Article.md');
    expect(replacePathPrefix('Java/Article.md', 'Java', 'Kotlin')).toBe('Kotlin/Article.md');
  });

  it('never rewrites an article outside the category', () => {
    expect(replacePathPrefix('Java/Spring/Article.md', 'Java', 'Kotlin')).toBe(
      'Kotlin/Spring/Article.md',
    );
    expect(replacePathPrefix('Go/Article.md', 'Java', 'Kotlin')).toBe('Go/Article.md');
  });

  it('ignores an empty source prefix instead of prepending to every path', () => {
    expect(replacePathPrefix('Java/Article.md', '', 'Kotlin')).toBe('Java/Article.md');
  });
});

describe('wildcardParam', () => {
  it('joins the segments Express 5 hands a named wildcard', () => {
    expect(wildcardParam(['Java', 'JUC', 'Article.md'])).toBe('Java/JUC/Article.md');
  });

  it('passes through a single %2F-encoded segment', () => {
    expect(wildcardParam('Java/JUC/Article.md')).toBe('Java/JUC/Article.md');
    expect(wildcardParam(['Java/JUC/Article.md'])).toBe('Java/JUC/Article.md');
  });

  it('treats a missing param as the root', () => {
    expect(wildcardParam(undefined)).toBe('');
    expect(wildcardParam([])).toBe('');
  });
});
