import { ArticleFrontmatter } from '../../common/frontmatter.service';
import { IndexedArticle } from '../../common/content-index.service';

export interface ArticleDto {
  path: string;
  frontmatter: ArticleFrontmatter;
  content: string;
}

export interface ArticleListItemDto {
  path: string;
  title: string;
  category: string;
  tags: string[];
  draft: boolean;
  published: string;
  description: string;
  image: string;
}

export interface PaginatedArticlesDto {
  data: ArticleListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Project an indexed article onto the list shape (no body is ever read). */
export function toArticleListItem(item: IndexedArticle): ArticleListItemDto {
  const { frontmatter } = item;
  return {
    path: item.relativePath,
    title: frontmatter.title,
    category: frontmatter.category,
    tags: frontmatter.tags,
    draft: frontmatter.draft,
    published: frontmatter.published,
    description: frontmatter.description,
    image: frontmatter.image,
  };
}
