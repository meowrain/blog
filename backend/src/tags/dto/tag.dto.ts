import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';

export interface TagDto {
  name: string;
  count: number;
}

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Body for `PATCH /tags/:name` — the tag being renamed comes from the path. */
export class RenameTagBodyDto {
  @Transform(trim)
  @IsString()
  @Length(1, 128)
  newName: string;
}

export class BulkTagBodyDto {
  @Transform(trim)
  @IsString()
  @Length(1, 128)
  tag: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  articlePaths: string[];
}

export class ListTagsQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsIn(['name', 'count'])
  sortBy?: string;
}

export class SuggestTagsQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 128)
  q?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  limit?: string;
}

export class LimitQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  limit?: string;
}
