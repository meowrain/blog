import { IsString, IsOptional } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { CreateArticleDto } from './create-article.dto';

/**
 * `category` (inherited) only rewrites the frontmatter; `newCategory` is what moves
 * the file. Send both to relabel a moved article, which is what the admin editor does.
 */
export class UpdateArticleDto extends PartialType(CreateArticleDto) {
  @IsOptional()
  @IsString()
  newTitle?: string; // Renames the file to the slug of this title

  @IsOptional()
  @IsString()
  newCategory?: string; // Moves the file under this category directory
}
