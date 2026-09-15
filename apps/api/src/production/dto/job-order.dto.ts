import {
  IsNotEmpty,
  IsUUID,
  IsNumber,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
  IsDateString,
  IsBoolean,
} from "class-validator";
import { Type } from "class-transformer";

export class JobOrderOperationDto {
  @IsOptional()
  @IsUUID()
  routingId?: string;

  @IsNumber()
  sequenceNumber: number;

  @IsNotEmpty()
  @IsString()
  operationName: string;

  @IsNotEmpty()
  @IsUUID()
  workstationId: string;

  @IsOptional()
  @IsUUID()
  assignedUserId?: string;

  @IsOptional()
  @IsDateString()
  startDatetime?: string;

  @IsOptional()
  @IsDateString()
  endDatetime?: string;

  @IsOptional()
  @IsNumber()
  expectedDurationHours?: number;

  @IsOptional()
  @IsNumber()
  setupTimeHours?: number;

  @IsOptional()
  @IsNumber()
  acceptedVariationPercent?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class JobOrderMaterialDto {
  @IsNotEmpty()
  @IsUUID()
  itemId: string;

  @IsOptional()
  @IsUUID()
  selectedVariantId?: string;

  @IsOptional()
  @IsString()
  variantNotes?: string;

  @IsNotEmpty()
  @IsNumber()
  requiredQuantity: number;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  routeOperationId?: string;

  @IsOptional()
  @IsString()
  issueMethod?: string;

  @IsOptional()
  @IsUUID()
  inputWarehouseId?: string;
}

export class CreateJobOrderDto {
  @IsNotEmpty()
  @IsUUID()
  itemId: string;

  @IsOptional()
  @IsUUID()
  bomId?: string;

  @IsNotEmpty()
  @IsNumber()
  quantity: number;

  @IsNotEmpty()
  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsUUID()
  salesOrderId?: string;

  @IsOptional()
  @IsUUID()
  salesOrderItemId?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID()
  assignedTo?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JobOrderOperationDto)
  operations?: JobOrderOperationDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JobOrderMaterialDto)
  materials?: JobOrderMaterialDto[];

  @IsOptional()
  @IsBoolean()
  validateMaterialsOnCreate?: boolean;
}

export class UpdateJobOrderDto {
  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID()
  salesOrderId?: string;

  @IsOptional()
  @IsUUID()
  salesOrderItemId?: string;

  @IsOptional()
  assignedTo?: string | null;
}

export class UpdateOperationDto {
  @IsOptional()
  @IsUUID()
  assignedUserId?: string;

  @IsOptional()
  @IsDateString()
  startDatetime?: string;

  @IsOptional()
  @IsDateString()
  endDatetime?: string;

  @IsOptional()
  @IsDateString()
  actualStartDatetime?: string;

  @IsOptional()
  @IsDateString()
  actualEndDatetime?: string;

  @IsOptional()
  @IsNumber()
  completedQuantity?: number;

  @IsOptional()
  @IsNumber()
  rejectedQuantity?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;
  @IsOptional()
  @IsUUID()
  assignedTo?: string;
}

export class PartialCompleteJobOrderDto {
  @IsNotEmpty()
  @IsNumber()
  producedQuantity: number;
}
