import { IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';

export interface CategoryDto {
  name: string;
  /** Posix path relative to POSTS_DIR, e.g. `frontend/react`. */
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

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class RenameCategoryDto {
  @Transform(trim)
  @IsString()
  @Length(1, 512)
  oldName: string;

  @Transform(trim)
  @IsString()
  @Length(1, 512)
  newName: string;
}

export class DeleteCategoryQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 512)
  moveTo?: string;

  /** Anything other than `true` counts as false: the caller must opt in. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  deleteArticles?: string;
}
