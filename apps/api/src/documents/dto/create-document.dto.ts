import { IsString, IsEnum, IsOptional, IsUUID, IsDate, IsArray } from 'class-validator';

export enum DocumentType {
  QUOTATION = 'QUOTATION',
  PURCHASE_ORDER = 'PURCHASE_ORDER',
  INVOICE = 'INVOICE',
  CONTRACT = 'CONTRACT',
  TECHNICAL_DRAWING = 'TECHNICAL_DRAWING',
  SPECIFICATION = 'SPECIFICATION',
  REPORT = 'REPORT',
  CORRESPONDENCE = 'CORRESPONDENCE',
  CERTIFICATE = 'CERTIFICATE',
  WARRANTY = 'WARRANTY',
  OTHER = 'OTHER',
}

export enum DocumentStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  ARCHIVED = 'ARCHIVED',
  OBSOLETE = 'OBSOLETE',
}

export class CreateDocumentDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(DocumentType)
  documentType: DocumentType;

  @IsOptional()
  @IsString()
  documentNumber?: string;

  @IsOptional()
  @IsDate()
  documentDate?: Date;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsString()
  entityType?: string; // 'quotation', 'purchase_order', etc.

  @IsOptional()
  @IsUUID()
  entityId?: string; // ID of the related entity
}

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;

  @IsOptional()
  @IsArray()
  tags?: string[];
}

export class ApproveDocumentDto {
  @IsOptional()
  @IsString()
  comments?: string;
}

export class LinkDocumentDto {
  @IsString()
  entityType: string;

  @IsUUID()
  entityId: string;

  @IsOptional()
  @IsString()
  linkType?: string; // 'attachment', 'reference', 'revision'

  @IsOptional()
  @IsString()
  notes?: string;
}

export class SearchDocumentsDto {
  @IsOptional()
  @IsString()
  query?: string;

  @IsOptional()
  @IsEnum(DocumentType)
  documentType?: DocumentType;

  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;

  @IsOptional()
  @IsDate()
  dateFrom?: Date;

  @IsOptional()
  @IsDate()
  dateTo?: Date;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsUUID()
  entityId?: string;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;
}
