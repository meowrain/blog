import { Injectable, NotFoundException } from '@nestjs/common';
import { FileService } from '../common/file.service';
import { FrontmatterService } from '../common/frontmatter.service';
import { TagDto } from './dto/tag.dto';

@Injectable()
export class TagsService {
  private tagCache: Map<string, number> = new Map();

  constructor(
    private readonly fileService: FileService,
    private readonly frontmatterService: FrontmatterService,
  ) {}

  /**
   * Get all tags
   */
  async findAll(sortBy = 'name'): Promise<TagDto[]> {
    await this.refreshCache();

    const tags = Array.from(this.tagCache.entries()).map(([name, count]) => ({
      name,
      count,
    }));

    if (sortBy === 'count') {
      tags.sort((a, b) => b.count - a.count);
    } else {
      tags.sort((a, b) => a.name.localeCompare(b.name));
    }

    return tags;
  }

  /**
   * Get popular tags
   */
  async findPopular(limit = 20): Promise<TagDto[]> {
    const tags = await this.findAll('count');
    return tags.slice(0, limit);
  }

  /**
   * Get one tag
   */
  async findOne(name: string): Promise<TagDto> {
    await this.refreshCache();

    const normalizedName = name.toLowerCase();
    for (const [tagName, count] of this.tagCache.entries()) {
      if (tagName.toLowerCase() === normalizedName) {
        return { name: tagName, count };
      }
    }

    throw new NotFoundException(`Tag not found: ${name}`);
  }

  /**
   * Get articles by tag
   */
  async getArticles(tagName: string): Promise<string[]> {
    const tag = await this.findOne(tagName);
    const files = await this.fileService.listFiles();
    const matchingFiles: string[] = [];

    const searchTag = tag.name.toLowerCase();

    for (const file of files) {
      try {
        const markdown = await this.fileService.readFile(file);
        const parsed = this.frontmatterService.parseFrontmatter(markdown);

        if (parsed.frontmatter.tags.some((t) => t.toLowerCase() === searchTag)) {
          matchingFiles.push(file);
        }
      } catch (error) {
        // Skip files that can't be read
      }
    }

    return matchingFiles;
  }

  /**
   * Rename a tag
   */
  async rename(oldName: string, newName: string): Promise<{ count: number }> {
    const files = await this.fileService.listFiles();
    const oldTagLower = oldName.toLowerCase();
    let count = 0;

    for (const file of files) {
      try {
        const markdown = await this.fileService.readFile(file);
        const parsed = this.frontmatterService.parseFrontmatter(markdown);

        const tagIndex = parsed.frontmatter.tags.findIndex(
          (t) => t.toLowerCase() === oldTagLower,
        );

        if (tagIndex !== -1) {
          // Replace tag (preserving original case if exact match, otherwise use exact oldName)
          parsed.frontmatter.tags[tagIndex] = newName;

          // Remove duplicates that might result from rename
          const uniqueTags = Array.from(new Set(parsed.frontmatter.tags));
          parsed.frontmatter.tags = uniqueTags;

          const updatedMarkdown = this.frontmatterService.writeFrontmatter(parsed);
          await this.fileService.writeFile(file, updatedMarkdown);

          count++;
        }
      } catch (error) {
        console.error(`Error updating ${file}:`, error);
      }
    }

    // Clear cache
    this.tagCache.clear();

    return { count };
  }

  /**
   * Delete a tag
   */
  async delete(tagName: string): Promise<{ count: number }> {
    const tag = await this.findOne(tagName);
    const files = await this.fileService.listFiles();
    const searchTag = tag.name.toLowerCase();
    let count = 0;

    for (const file of files) {
      try {
        const markdown = await this.fileService.readFile(file);
        const parsed = this.frontmatterService.parseFrontmatter(markdown);

        const originalLength = parsed.frontmatter.tags.length;
        parsed.frontmatter.tags = parsed.frontmatter.tags.filter(
          (t) => t.toLowerCase() !== searchTag,
        );

        if (parsed.frontmatter.tags.length !== originalLength) {
          const updatedMarkdown = this.frontmatterService.writeFrontmatter(parsed);
          await this.fileService.writeFile(file, updatedMarkdown);
          count++;
        }
      } catch (error) {
        console.error(`Error updating ${file}:`, error);
      }
    }

    // Clear cache
    this.tagCache.clear();

    return { count };
  }

  /**
   * Get tag suggestions
   */
  async suggest(query: string, limit = 10): Promise<TagDto[]> {
    await this.refreshCache();

    const queryLower = query.toLowerCase();
    const matches: TagDto[] = [];

    for (const [name, count] of this.tagCache.entries()) {
      if (name.toLowerCase().includes(queryLower)) {
        matches.push({ name, count });
        if (matches.length >= limit) {
          break;
        }
      }
    }

    return matches.sort((a, b) => b.count - a.count);
  }

  /**
   * Get related tags (frequently co-occurring)
   */
  async getRelated(tagName: string, limit = 10): Promise<TagDto[]> {
    const tag = await this.findOne(tagName);
    const files = await this.getArticles(tag.name);
    const coOccurrences = new Map<string, number>();

    const searchTag = tag.name.toLowerCase();

    for (const file of files) {
      try {
        const markdown = await this.fileService.readFile(file);
        const parsed = this.frontmatterService.parseFrontmatter(markdown);

        for (const t of parsed.frontmatter.tags) {
          if (t.toLowerCase() !== searchTag) {
            coOccurrences.set(
              t,
              (coOccurrences.get(t) ?? 0) + 1,
            );
          }
        }
      } catch (error) {
        // Skip files that can't be read
      }
    }

    const related = Array.from(coOccurrences.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    return related;
  }

  /**
   * Bulk tag operations
   */
  async bulkAdd(
    tagName: string,
    articlePaths: string[],
  ): Promise<{ count: number }> {
    let count = 0;

    for (const file of articlePaths) {
      try {
        const markdown = await this.fileService.readFile(file);
        const parsed = this.frontmatterService.parseFrontmatter(markdown);

        const tagLower = tagName.toLowerCase();
        if (!parsed.frontmatter.tags.some((t) => t.toLowerCase() === tagLower)) {
          parsed.frontmatter.tags.push(tagName);
          const updatedMarkdown = this.frontmatterService.writeFrontmatter(parsed);
          await this.fileService.writeFile(file, updatedMarkdown);
          count++;
        }
      } catch (error) {
        console.error(`Error updating ${file}:`, error);
      }
    }

    this.tagCache.clear();
    return { count };
  }

  async bulkRemove(
    tagName: string,
    articlePaths: string[],
  ): Promise<{ count: number }> {
    let count = 0;

    for (const file of articlePaths) {
      try {
        const markdown = await this.fileService.readFile(file);
        const parsed = this.frontmatterService.parseFrontmatter(markdown);

        const originalLength = parsed.frontmatter.tags.length;
        const tagLower = tagName.toLowerCase();
        parsed.frontmatter.tags = parsed.frontmatter.tags.filter(
          (t) => t.toLowerCase() !== tagLower,
        );

        if (parsed.frontmatter.tags.length !== originalLength) {
          const updatedMarkdown = this.frontmatterService.writeFrontmatter(parsed);
          await this.fileService.writeFile(file, updatedMarkdown);
          count++;
        }
      } catch (error) {
        console.error(`Error updating ${file}:`, error);
      }
    }

    this.tagCache.clear();
    return { count };
  }

  /**
   * Refresh tag cache from all articles
   */
  private async refreshCache(): Promise<void> {
    if (this.tagCache.size > 0) {
      return; // Cache is still valid
    }

    const files = await this.fileService.listFiles();
    const tagMap = new Map<string, number>();

    for (const file of files) {
      try {
        const markdown = await this.fileService.readFile(file);
        const parsed = this.frontmatterService.parseFrontmatter(markdown);

        for (const tag of parsed.frontmatter.tags) {
          tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
        }
      } catch (error) {
        // Skip files that can't be read
      }
    }

    this.tagCache = tagMap;
  }
}
