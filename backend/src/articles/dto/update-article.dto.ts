import { IsString, IsArray, IsOptional, IsBoolean, IsDateString } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { CreateArticleDto } from './create-article.dto';

export class UpdateArticleDto extends PartialType(CreateArticleDto) {
  @IsOptional()
  @IsString()
  newTitle?: string; // For renaming file (changes path)

  @IsOptional()
  @IsString()
  newCategory?: string; // For moving to different category
}
