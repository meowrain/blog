import { ArticleFrontmatter } from '../../common/frontmatter.service';

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
