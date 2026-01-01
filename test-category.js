const CATEGORY_SEPARATOR = " > ";

function parseCategoryPath(categoryString) {
  return categoryString
    .split(CATEGORY_SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean);
}

function stringifyCategoryPath(path) {
  return path.join(CATEGORY_SEPARATOR);
}

function getPostCategories(post) {
  const category = post.data.category;
  if (typeof category === "string") {
    return [category];
  }
  return category;
}

function getPostsByCategory(posts, categoryPath) {
  const targetPathString = stringifyCategoryPath(categoryPath);
  console.log(`Target Path: "${targetPathString}"`);

  return posts.filter((post) => {
    const categories = getPostCategories(post);
    return categories.some((cat) => {
      const catPath = parseCategoryPath(cat);
      const catPathString = stringifyCategoryPath(catPath);
      console.log(`  Checking Post Category: "${catPathString}"`);

      const match =
        catPathString === targetPathString ||
        catPathString.startsWith(targetPathString + CATEGORY_SEPARATOR);
      console.log(`    Match: ${match}`);
      return match;
    });
  });
}

// Mock data
const posts = [
  { data: { title: "Post 1", category: "Java" } },
  { data: { title: "Post 2", category: "Java > JVM" } },
  { data: { title: "Post 3", category: "Python" } },
];

const categoryPath = ["Java"];

const result = getPostsByCategory(posts, categoryPath);
console.log(
  "Result:",
  result.map((p) => p.data.title)
);
