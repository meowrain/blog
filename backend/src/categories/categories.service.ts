import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import path from 'path';
import { FileService } from '../common/file.service';
import { FrontmatterService } from '../common/frontmatter.service';
import { PATHS } from '../common/constants';
import { CategoryDto, CategoryTreeDto } from './dto/category.dto';

interface CategoryNode {
  name: string;
  path: string;
  articleCount: number;
  children: Map<string, CategoryNode>;
}

@Injectable()
export class CategoriesService {
  private categoryCache: Map<string, CategoryDto> = new Map();

  constructor(
    private readonly fileService: FileService,
    private readonly frontmatterService: FrontmatterService,
  ) {}

  /**
   * Get all categories (flat list)
   */
  async findAll(): Promise<CategoryDto[]> {
    await this.refreshCache();
    return Array.from(this.categoryCache.values()).sort((a, b) =>
      a.path.localeCompare(b.path),
    );
  }

  /**
   * Get category tree structure
   */
  async findTree(): Promise<CategoryTreeDto[]> {
    const categories = await this.findAll();
    const rootMap = new Map<string, CategoryNode>();

    // Initialize root nodes
    for (const category of categories) {
      const parts = category.path.split(path.sep);
      let currentLevel = rootMap;
      let currentPath = '';

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        currentPath = i === 0 ? part : path.join(currentPath, part);

        if (!currentLevel.has(part)) {
          currentLevel.set(part, {
            name: part,
            path: currentPath,
            articleCount: 0,
            children: new Map(),
          });
        }

        if (i === parts.length - 1) {
          // This is the actual category node
          const node = currentLevel.get(part)!;
          node.articleCount = category.articleCount;
        }

        currentLevel = currentLevel.get(part)!.children;
      }
    }

    // Convert to tree structure
    return this.buildTree(Array.from(rootMap.values()));
  }

  /**
   * Get one category by name/path
   */
  async findOne(pathOrName: string): Promise<CategoryDto> {
    await this.refreshCache();

    // Normalize path
    const normalizedPath = this.normalizeCategoryPath(pathOrName).replace(/\//g, path.sep);

    // Try exact match first
    if (this.categoryCache.has(normalizedPath)) {
      return this.categoryCache.get(normalizedPath)!;
    }

    // Try finding by partial match
    for (const [key, value] of this.categoryCache.entries()) {
      if (key === normalizedPath || key.endsWith(path.sep + normalizedPath)) {
        return value;
      }
    }

    throw new NotFoundException(`Category not found: ${pathOrName}`);
  }

  /**
   * Get articles by category
   */
  async getArticles(categoryPath: string): Promise<string[]> {
    const category = await this.findOne(categoryPath);
    const allFiles = await this.fileService.listFiles();

    const categoryPattern = this.normalizeCategoryPath(category.path).replace(/\//g, path.sep);
    return allFiles.filter((f) => {
      const dir = path.dirname(f);
      return dir === categoryPattern || dir.startsWith(categoryPattern + path.sep);
    });
  }

  /**
   * Rename a category
   */
  async rename(oldPath: string, newPath: string): Promise<{ count: number }> {
    const category = await this.findOne(oldPath);
    const normalizedNewPath = this.normalizeCategoryPath(newPath);

    // Get all articles in this category
    const articlePaths = await this.getArticles(oldPath);
    let count = 0;

    for (const articlePath of articlePaths) {
      try {
        // Build new path
        const relativePath = articlePath.replace(
          category.path.replace(/\//g, path.sep),
          normalizedNewPath.replace(/\//g, path.sep),
        );

        // Read article
        const markdown = await this.fileService.readFile(articlePath);
        const parsed = this.frontmatterService.parseFrontmatter(markdown);

        // Update frontmatter category
        parsed.frontmatter.category = normalizedNewPath.split('/').join(' > ');
        const updatedMarkdown = this.frontmatterService.writeFrontmatter(parsed);

        // Move file and update content
        await this.fileService.moveFile(articlePath, relativePath);
        await this.fileService.writeFile(relativePath, updatedMarkdown);

        count++;
      } catch (error) {
        console.error(`Error moving ${articlePath}:`, error);
      }
    }

    // Refresh cache after operation
    this.categoryCache.clear();

    return { count };
  }

  /**
   * Delete a category
   */
  async delete(
    categoryPath: string,
    moveArticlesTo?: string,
    deleteArticles = false,
  ): Promise<{ count: number }> {
    const category = await this.findOne(categoryPath);
    const articlePaths = await this.getArticles(categoryPath);
    let count = 0;

    if (deleteArticles) {
      // Delete all articles
      for (const articlePath of articlePaths) {
        try {
          await this.fileService.deleteFile(articlePath);
          count++;
        } catch (error) {
          console.error(`Error deleting ${articlePath}:`, error);
        }
      }
    } else if (moveArticlesTo) {
      // Move articles to new category
      const normalizedTargetPath = this.normalizeCategoryPath(moveArticlesTo);
      const targetPath = normalizedTargetPath.replace(/\//g, path.sep);

      for (const articlePath of articlePaths) {
        try {
          const filename = path.basename(articlePath);
          const newRelativePath = path.join(targetPath, filename);

          // Read and update article
          const markdown = await this.fileService.readFile(articlePath);
          const parsed = this.frontmatterService.parseFrontmatter(markdown);
          parsed.frontmatter.category = normalizedTargetPath.split('/').join(' > ');
          const updatedMarkdown = this.frontmatterService.writeFrontmatter(parsed);

          // Move file
          await this.fileService.moveFile(articlePath, newRelativePath);
          await this.fileService.writeFile(newRelativePath, updatedMarkdown);

          count++;
        } catch (error) {
          console.error(`Error moving ${articlePath}:`, error);
        }
      }
    }

    // Refresh cache
    this.categoryCache.clear();

    return { count };
  }

  /**
   * Refresh category cache from file system
   */
  private async refreshCache(): Promise<void> {
    if (this.categoryCache.size > 0) {
      return; // Cache is still valid
    }

    const files = await this.fileService.listFiles();
    const categoryMap = new Map<string, number>();

    // Count articles per category
    for (const file of files) {
      const dir = path.dirname(file);
      const categoryPath = dir === '.' ? '' : dir;

      categoryMap.set(categoryPath, (categoryMap.get(categoryPath) ?? 0) + 1);

      // Also count all parent categories
      const parts = categoryPath.split(path.sep);
      for (let i = 0; i < parts.length - 1; i++) {
        const parentPath = parts.slice(0, i + 1).join(path.sep);
        categoryMap.set(parentPath, (categoryMap.get(parentPath) ?? 0) + 1);
      }
    }

    // Build category DTOs
    this.categoryCache.clear();
    for (const [categoryPath, count] of categoryMap.entries()) {
      const parts = categoryPath.split(path.sep);
      const name = parts[parts.length - 1] || 'Root';

      this.categoryCache.set(categoryPath, {
        name,
        path: categoryPath,
        articleCount: count,
        parent: parts.length > 1 ? parts.slice(0, -1).join(path.sep) : undefined,
      });
    }
  }

  /**
   * Build tree structure from nodes
   */
  private buildTree(nodes: CategoryNode[]): CategoryTreeDto[] {
    return nodes.map((node) => ({
      name: node.name,
      path: node.path,
      articleCount: node.articleCount,
      children: this.buildTree(Array.from(node.children.values())),
    }));
  }

  private normalizeCategoryPath(input?: string): string {
    if (!input) return '';
    return input
      .replace(/>/g, '/')
      .replace(/[\\\/]+/g, '/')
      .split('/')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .join('/');
  }
}
