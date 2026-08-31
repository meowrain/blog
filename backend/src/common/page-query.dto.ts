import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { PageQuery } from './pagination.util';

/**
 * Shared `?page=&limit=` query for the list endpoints. Values are optional:
 * when absent the caller gets the default page, and the service clamps the
 * size, so no request can ask for the whole store.
 */
export class PageQueryDto implements PageQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
