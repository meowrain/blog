import { IsArray, IsEnum, IsString, IsOptional } from 'class-validator';

export enum BulkOperationType {
  DELETE = 'delete',
  UPDATE_CATEGORY = 'update_category',
  ADD_TAG = 'add_tag',
  REMOVE_TAG = 'remove_tag',
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
}

export interface BulkFailureItem {
  path: string;
  reason: string;
}

export interface BulkOperationResultDto {
  total: number;
  success: number;
  failed: number;
  failures: BulkFailureItem[];
}
