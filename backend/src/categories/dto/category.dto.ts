export interface CategoryDto {
  name: string;
  path: string;
  articleCount: number;
  parent?: string;
}

export interface CategoryTreeDto {
  name: string;
  path: string;
  articleCount: number;
  children: CategoryTreeDto[];
}

export interface RenameCategoryDto {
  oldName: string;
  newName: string;
}

export interface DeleteCategoryDto {
  name: string;
  moveArticlesTo?: string; // Destination category for articles
  deleteArticles?: boolean; // If true, delete articles instead of moving
}
