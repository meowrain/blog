import type { CollectionEntry } from "astro:content";
import type {
  CategoryNode,
  CategoryPath,
  CategoryPathString,
  CategoryTree,
} from "@/types/config";

// Separator constant for category hierarchy
export const CATEGORY_SEPARATOR = " > ";
export const CATEGORY_URL_PREFIX = "/category/";

/**
 * Parse category string into path array
 * "技术 > Java" => ["技术", "Java"]
 * "教程" => ["教程"]
 */
export function parseCategoryPath(categoryString: string): CategoryPath {
  return categoryString
    .split(CATEGORY_SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Convert path array to category string
 * ["技术", "Java"] => "技术 > Java"
 */
export function stringifyCategoryPath(path: CategoryPath): string {
  return path.join(CATEGORY_SEPARATOR);
}

/**
 * Convert category path to filesystem-safe slug
 * ["技术", "Java"] => "技术-Java"
 * Replaces " > " with "-" to avoid filesystem issues on Windows
 */
export function getCategorySlug(path: CategoryPath): string {
  return path.join("-");
}

/**
 * Parse filesystem-safe slug back to category path
 * "技术-Java" => ["技术", "Java"]
 */
export function parseSlugToCategoryPath(slug: string): CategoryPath {
  return slug.split("-").filter(Boolean);
}

/**
 * Generate category URL
 * ["技术", "Java"] => "/category/技术-Java/"
 */
export function getCategoryUrl(path: CategoryPath): string {
  const slug = getCategorySlug(path);
  return `${CATEGORY_URL_PREFIX}${slug}/`;
}

/**
 * Extract all categories from post (handles single and multi-category)
 */
export function getPostCategories(post: CollectionEntry<"posts">): string[] {
  const category = post.data.category;
  if (!category) return [];

  // Backward compatibility: if string, convert to array
  if (typeof category === "string") {
    return [category];
  }

  return category;
}

/**
 * Build category tree from all posts
 */
export async function buildCategoryTree(
  posts: CollectionEntry<"posts">[]
): Promise<CategoryTree> {
  const tree: CategoryTree = {};

  for (const post of posts) {
    const categories = getPostCategories(post);

    for (const categoryString of categories) {
      const path = parseCategoryPath(categoryString);

      // Create node for each level
      for (let i = 0; i < path.length; i++) {
        const currentPath = path.slice(0, i + 1);
        const pathString = stringifyCategoryPath(currentPath);
        const url = getCategoryUrl(currentPath);

        if (!tree[pathString]) {
          tree[pathString] = {
            name: path[i],
            path: currentPath,
            pathString,
            url,
            count: 0,
            children: [],
          };

          // Establish parent-child relationship
          if (i > 0) {
            const parentPathString = stringifyCategoryPath(path.slice(0, i));
            if (tree[parentPathString]) {
              if (!tree[parentPathString].children) {
                tree[parentPathString].children = [];
              }
              tree[parentPathString].children?.push(tree[pathString]);
            }
          }
        }

        // Only increment count for full path
        if (i === path.length - 1) {
          tree[pathString].count++;
        }
      }
    }
  }

  return tree;
}

/**
 * Get all posts for a specific category
 */
export async function getPostsByCategory(
  posts: CollectionEntry<"posts">[],
  categoryPath: CategoryPath
): Promise<CollectionEntry<"posts">[]> {
  const targetPathString = stringifyCategoryPath(categoryPath);
  console.log(
    `[Debug] getPostsByCategory target: "${targetPathString}", posts: ${posts.length}`
  );

  return posts.filter((post) => {
    const categories = getPostCategories(post);
    const match = categories.some((cat) => {
      const catPath = parseCategoryPath(cat);
      const catPathString = stringifyCategoryPath(catPath);
      const isMatch =
        catPathString === targetPathString ||
        catPathString.startsWith(targetPathString + CATEGORY_SEPARATOR);
      return isMatch;
    });
    if (match) console.log(`[Debug] Matched post: "${post.data.title}"`);
    return match;
  });
}

/**
 * Get breadcrumb navigation path
 */
export function getCategoryBreadcrumbs(categoryPath: CategoryPath): Array<{
  name: string;
  url: string;
}> {
  const breadcrumbs: Array<{ name: string; url: string }> = [];

  for (let i = 0; i < categoryPath.length; i++) {
    const currentPath = categoryPath.slice(0, i + 1);
    breadcrumbs.push({
      name: categoryPath[i],
      url: getCategoryUrl(currentPath),
    });
  }

  return breadcrumbs;
}
