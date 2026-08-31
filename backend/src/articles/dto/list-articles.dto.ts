import { IsBoolean, IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';

/** Query strings arrive as 'true' / 'false' / 'all'; 'all' means "no filter". */
const toDraftFilter = ({ value }: { value: unknown }): boolean | undefined => {
  if (value === 'true' || value === true) {
    return true;
  }
  return value === 'false' || value === false ? false : undefined;
};

export class ListArticlesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(toDraftFilter)
  @IsBoolean()
  draft?: boolean;
}
