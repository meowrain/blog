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

function getPostsByCategory(posts, categoryPath) {
  const targetPathString = stringifyCategoryPath(categoryPath);
  console.log(`Target Path: "${targetPathString}"`);

  return posts.filter((post) => {
    const categories = post.data.category;
    const categoryArray =
      typeof categories === "string" ? [categories] : categories;

    return categoryArray.some((cat) => {
      const catPath = parseCategoryPath(cat);
      const catPathString = stringifyCategoryPath(catPath);
      console.log(
        `  Checking Post: "${post.data.title}", Category: "${cat}", Parsed: "${catPathString}"`
      );

      const match =
        catPathString === targetPathString ||
        catPathString.startsWith(targetPathString + CATEGORY_SEPARATOR);
      console.log(`    Match: ${match}`);
      return match;
    });
  });
}

// Mock Data
const posts = [
  {
    data: {
      title: "Post 1",
      category: "Java > Spring",
    },
  },
  {
    data: {
      title: "Post 2",
      category: ["Java > Spring"],
    },
  },
  {
    data: {
      title: "Post 3",
      category: "Java > Spring > Boot",
    },
  },
  {
    data: {
      title: "Post 4",
      category: "Java",
    },
  },
  {
    data: {
      title: "Post 5",
      category: "Other > Spring",
    },
  },
];

const targetPath = ["Java", "Spring"];

console.log("Testing getPostsByCategory...");
const result = getPostsByCategory(posts, targetPath);
console.log(`Found ${result.length} posts.`);
result.forEach((p) => console.log(` - ${p.data.title}`));
