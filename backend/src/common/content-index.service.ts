import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { watch, type FSWatcher } from 'fs';
import { FileService } from './file.service';
import { FrontmatterService, ArticleFrontmatter } from './frontmatter.service';
import { categoryOf, toPosix } from './path.util';
import { mapWithConcurrency } from './async.util';
import { PATHS, LIMITS } from './constants';

export interface IndexedArticle {
  /** Path relative to POSTS_DIR, using the platform separator. */
  relativePath: string;
  /** Category path (posix) derived from the containing directory. */
  categoryPath: string;
  frontmatter: ArticleFrontmatter;
  mtimeMs: number;
  size: number;
}

interface CacheEntry {
  frontmatter: ArticleFrontmatter;
  mtimeMs: number;
  size: number;
}

/**
 * Single source of truth for article metadata.
 *
 * Every list/tag/category read used to walk POSTS_DIR and parse whole documents
 * on its own, so a single /articles request could read every file up to four
 * times. This service walks once, reads only the frontmatter, keeps the result
 * keyed by mtime so unchanged files are never re-read, and invalidates on any
 * write through FileService (plus out-of-band edits via fs.watch).
 */
@Injectable()
export class ContentIndexService implements OnModuleDestroy {
  private readonly logger = new Logger(ContentIndexService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private builtAt = 0;
  private built = false;
  private inflight: Promise<void> | null = null;
  private readonly stopMutationHook: () => void;
  private watcher: FSWatcher | null = null;
  private watchTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly fileService: FileService,
    private readonly frontmatterService: FrontmatterService,
  ) {
    this.stopMutationHook = this.fileService.onFileMutation(() => this.invalidate());
    // fs.watch keeps the event loop alive, so it stays off under jest.
    if (process.env.NODE_ENV !== 'test') {
      this.startWatcher();
    }
  }

  /** Every indexed article, rebuilding first when the index is stale. */
  async getItems(): Promise<IndexedArticle[]> {
    if (!this.isFresh()) {
      await this.rebuild();
    }
    return this.snapshot();
  }

  /** Force the next read to rescan. Cheap: unchanged files reuse cached parses. */
  invalidate(): void {
    this.built = false;
  }

  /**
   * Tag name -> article count, and category path -> article count, both in one
   * pass over the index. Used by /tags and /categories.
   */
  async aggregate(): Promise<{
    tags: Map<string, number>;
    categories: Map<string, number>;
  }> {
    const items = await this.getItems();
    const tags = new Map<string, number>();
    const categories = new Map<string, number>();

    for (const item of items) {
      for (const tag of item.frontmatter.tags) {
        tags.set(tag, (tags.get(tag) ?? 0) + 1);
      }

      const segments = item.categoryPath ? item.categoryPath.split('/') : [];
      let current = '';
      for (const segment of segments) {
        current = current ? `${current}/${segment}` : segment;
        categories.set(current, (categories.get(current) ?? 0) + 1);
      }
    }

    return { tags, categories };
  }

  onModuleDestroy(): void {
    this.stopMutationHook();
    this.watcher?.close();
    this.watcher = null;
    if (this.watchTimer) {
      clearTimeout(this.watchTimer);
      this.watchTimer = null;
    }
  }

  private snapshot(): IndexedArticle[] {
    const items: IndexedArticle[] = [];
    for (const [relativePath, entry] of this.cache) {
      items.push({
        relativePath,
        categoryPath: categoryOf(relativePath),
        frontmatter: entry.frontmatter,
        mtimeMs: entry.mtimeMs,
        size: entry.size,
      });
    }
    return items;
  }

  private isFresh(): boolean {
    return this.built && Date.now() - this.builtAt < LIMITS.INDEX_TTL_MS;
  }

  /** Concurrent callers share one rebuild rather than each starting a scan. */
  private rebuild(): Promise<void> {
    if (!this.inflight) {
      const run = this.build().finally(() => {
        if (this.inflight === run) {
          this.inflight = null;
        }
      });
      this.inflight = run;
    }
    return this.inflight;
  }

  private async build(): Promise<void> {
    const started = Date.now();
    const entries = await this.fileService.listFilesWithStats();
    const seen = new Set<string>();

    const pending = entries.filter((entry) => {
      const key = this.normalizeKey(entry.relativePath);
      seen.add(key);
      const cached = this.cache.get(key);
      return !cached || cached.mtimeMs !== entry.mtimeMs || cached.size !== entry.size;
    });

    await mapWithConcurrency(pending, LIMITS.BULK_CONCURRENCY, async (entry) => {
      const key = this.normalizeKey(entry.relativePath);
      try {
        const frontmatter = await this.readFrontmatter(entry.relativePath);
        this.cache.set(key, {
          frontmatter,
          mtimeMs: entry.mtimeMs,
          size: entry.size,
        });
      } catch (error) {
        this.logger.warn(`Skipped ${entry.relativePath}: ${error.message}`);
      }
    });

    for (const key of this.cache.keys()) {
      if (!seen.has(key)) {
        this.cache.delete(key);
      }
    }

    this.built = true;
    this.builtAt = Date.now();

    if (pending.length > 0) {
      this.logger.debug(
        `Index rebuilt in ${this.builtAt - started}ms (${pending.length}/${entries.length} parsed)`,
      );
    }
  }

  /**
   * Parse only what the metadata needs: a head slice covers almost every article,
   * and the full document is only read for a frontmatter block that outgrows it.
   */
  private async readFrontmatter(relativePath: string): Promise<ArticleFrontmatter> {
    const head = await this.fileService.readHead(relativePath);

    if (!this.frontmatterService.startsFrontmatter(head)) {
      return this.frontmatterService.parseFrontmatterOnly(head);
    }
    if (this.frontmatterService.extractFrontmatterBlock(head) === null) {
      // Either the block is longer than the head window or it is unterminated;
      // only the full document can answer that.
      return this.frontmatterService.parseFrontmatterOnly(
        await this.fileService.readFile(relativePath),
      );
    }
    return this.frontmatterService.parseFrontmatterOnly(head);
  }

  private normalizeKey(relativePath: string): string {
    return toPosix(relativePath);
  }

  private startWatcher(): void {
    try {
      this.watcher = watch(PATHS.POSTS_DIR, { recursive: true }, () => {
        // Editors fire a burst of events per save; one invalidation is enough.
        if (this.watchTimer) {
          return;
        }
        this.watchTimer = setTimeout(() => {
          this.watchTimer = null;
          this.invalidate();
        }, 200);
        this.watchTimer.unref?.();
      });
      this.watcher.on('error', (error) => {
        this.logger.warn(`File watcher disabled: ${error.message}`);
        this.watcher = null;
      });
    } catch (error) {
      this.logger.warn(`File watcher unavailable: ${error.message}`);
    }
  }
}
