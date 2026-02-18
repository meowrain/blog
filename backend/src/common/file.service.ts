import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import path from 'path';
import { PATHS, INVALID_PATH_CHARS } from './constants';

@Injectable()
export class FileService {
  /**
   * Read a file's content
   */
  async readFile(filePath: string): Promise<string> {
    const validatedPath = this.validatePath(filePath);
    try {
      return await fs.readFile(validatedPath, 'utf-8');
    } catch (error) {
      throw new NotFoundException(`File not found: ${filePath}`);
    }
  }

  /**
   * Write content to a file (creates directories if needed)
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    const validatedPath = this.validatePath(filePath);
    const dir = path.dirname(validatedPath);
    await this.ensureDir(dir);
    await fs.writeFile(validatedPath, content, 'utf-8');
  }

  /**
   * Delete a file
   */
  async deleteFile(filePath: string): Promise<void> {
    const validatedPath = this.validatePath(filePath);
    try {
      await fs.unlink(validatedPath);
    } catch (error) {
      throw new NotFoundException(`File not found: ${filePath}`);
    }
  }

  /**
   * Move a file from source to destination
   */
  async moveFile(sourcePath: string, targetPath: string): Promise<void> {
    const validatedSource = this.validatePath(sourcePath);
    const validatedTarget = this.validatePath(targetPath);

    // Ensure target directory exists
    const targetDir = path.dirname(validatedTarget);
    await this.ensureDir(targetDir);

    try {
      await fs.rename(validatedSource, validatedTarget);
    } catch (error) {
      throw new BadRequestException(`Failed to move file: ${error.message}`);
    }
  }

  /**
   * List all markdown files in a directory (recursively)
   */
  async listFiles(dirPath: string = PATHS.POSTS_DIR): Promise<string[]> {
    const validatedPath = this.validatePath(dirPath);
    const markdownFiles: string[] = [];

    async function scanDirectory(currentPath: string): Promise<void> {
      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);

          if (entry.isDirectory()) {
            await scanDirectory(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name);
            if (PATHS.MARKDOWN_EXTENSIONS.includes(ext)) {
              // Get relative path from POSTS_DIR
              const relativePath = path.relative(PATHS.POSTS_DIR, fullPath);
              markdownFiles.push(relativePath);
            }
          }
        }
      } catch (error) {
        // Skip directories we can't read
      }
    }

    await scanDirectory(validatedPath);
    return markdownFiles;
  }

  /**
   * Ensure a directory exists (create if needed)
   */
  async ensureDir(dirPath: string): Promise<void> {
    const validatedPath = this.validatePath(dirPath);
    await fs.mkdir(validatedPath, { recursive: true });
  }

  /**
   * Check if a file exists
   */
  async fileExists(filePath: string): Promise<boolean> {
    const validatedPath = this.validatePath(filePath);
    try {
      await fs.access(validatedPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate and sanitize a file path to prevent path traversal attacks
   */
  private validatePath(inputPath: string): string {
    // Convert to absolute path if relative
    let resolvedPath: string;

    if (path.isAbsolute(inputPath)) {
      resolvedPath = inputPath;
    } else {
      // If path starts with POSTS_DIR or is relative, resolve against POSTS_DIR
      resolvedPath = path.resolve(PATHS.POSTS_DIR, inputPath);
    }

    // Normalize path to remove any '..' or '.'
    resolvedPath = path.normalize(resolvedPath);

    // Ensure the resolved path is within POSTS_DIR
    const postsDirResolved = path.resolve(PATHS.POSTS_DIR);

    if (!resolvedPath.startsWith(postsDirResolved)) {
      throw new BadRequestException('Invalid path: access denied');
    }

    return resolvedPath;
  }

  /**
   * Validate a category or tag name (prevent invalid characters)
   */
  validateName(name: string): boolean {
    if (!name || name.trim().length === 0) {
      return false;
    }

    // Check for invalid characters
    if (INVALID_PATH_CHARS.test(name)) {
      return false;
    }

    return true;
  }

  /**
   * Sanitize a name for use in file paths
   */
  sanitizeName(name: string): string {
    return name.trim().replace(/[\\/]+/g, '/').replace(/\/+/g, '/');
  }

  /**
   * Get stats about a file
   */
  async getFileStats(filePath: string) {
    const validatedPath = this.validatePath(filePath);
    try {
      const stats = await fs.stat(validatedPath);
      return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
      };
    } catch (error) {
      throw new NotFoundException(`File not found: ${filePath}`);
    }
  }
}
