import { IsArray, IsBoolean, IsEnum, IsString, IsOptional } from 'class-validator';

export enum BulkOperationType {
  DELETE = 'delete',
  UPDATE_CATEGORY = 'update_category',
  ADD_TAG = 'add_tag',
  REMOVE_TAG = 'remove_tag',
  SET_DRAFT = 'set_draft',
}

export class BulkOperationDto {
  @IsArray()
  @IsString({ each: true })
  paths!: string[];

  @IsEnum(BulkOperationType)
  operation!: BulkOperationType;

  @IsOptional()
  @IsString()
  category?: string; // For UPDATE_CATEGORY

  @IsOptional()
  @IsString()
  tag?: string; // For ADD_TAG or REMOVE_TAG

  @IsOptional()
  @IsBoolean()
  draft?: boolean; // For SET_DRAFT
}

export interface BulkFailureItem {
  path: string;
  reason: string;
}

export interface BulkOperationResultDto {
  total: number;
  success: number;
  /** Items already in the requested state, so nothing was written. */
  skipped: number;
  failed: number;
  failures: BulkFailureItem[];
}
