export interface TagDto {
  name: string;
  count: number;
}

export interface RenameTagDto {
  oldName: string;
  newName: string;
}

export interface BulkTagOperationDto {
  tag: string;
  operation: 'add' | 'remove';
  articlePaths?: string[];
}
