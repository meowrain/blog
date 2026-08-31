import { IsString, IsArray, IsOptional, IsBoolean } from 'class-validator';

export class CreateArticleDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsBoolean()
  draft?: boolean;

  @IsOptional()
  @IsString()
  lang?: string;

  /** Replace the file when the generated path already exists (default: 409). */
  @IsOptional()
  @IsBoolean()
  overwrite?: boolean;

  @IsString()
  content!: string;
}
