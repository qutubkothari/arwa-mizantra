import { IsNotEmpty, IsString, IsUUID, IsOptional, IsEnum, IsDateString, IsBoolean, IsEmail } from 'class-validator';

// Predefined deployment levels (can also accept custom values)
export enum DeploymentLevel {
  CUSTOMER = 'CUSTOMER',
  DEPOT = 'DEPOT',
  END_LOCATION = 'END_LOCATION',
  SERVICE_CENTER = 'SERVICE_CENTER',
  RETURNED = 'RETURNED',
}

export class CreateDeploymentDto {
  @IsNotEmpty()
  @IsUUID()
  uid_id: string;

  @IsNotEmpty()
  @IsString()
  deployment_level: string;

  @IsNotEmpty()
  @IsString()
  organization_name: string;

  @IsNotEmpty()
  @IsString()
  location_name: string;

  @IsNotEmpty()
  @IsDateString()
  deployment_date: string;

  @IsOptional()
  @IsUUID()
  parent_deployment_id?: string;

  @IsOptional()
  @IsString()
  contact_person?: string;

  @IsOptional()
  @IsEmail()
  contact_email?: string;

  @IsOptional()
  @IsString()
  contact_phone?: string;

  @IsOptional()
  @IsString()
  deployment_notes?: string;

  @IsOptional()
  @IsDateString()
  warranty_expiry_date?: string;

  @IsOptional()
  @IsString()
  maintenance_schedule?: string;

  @IsOptional()
  @IsBoolean()
  is_current_location?: boolean;

  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @IsOptional()
  @IsBoolean()
  commissioning_confirmed?: boolean;
}

export class UpdateDeploymentDto {
  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @IsOptional()
  @IsString()
  organization_name?: string;

  @IsOptional()
  @IsString()
  location_name?: string;

  @IsOptional()
  @IsDateString()
  deployment_date?: string;

  @IsOptional()
  @IsString()
  contact_person?: string;

  @IsOptional()
  @IsEmail()
  contact_email?: string;

  @IsOptional()
  @IsString()
  contact_phone?: string;

  @IsOptional()
  @IsString()
  deployment_notes?: string;

  @IsOptional()
  @IsDateString()
  warranty_expiry_date?: string;

  @IsOptional()
  @IsString()
  maintenance_schedule?: string;

  @IsOptional()
  @IsBoolean()
  is_current_location?: boolean;

  @IsOptional()
  @IsBoolean()
  commissioning_confirmed?: boolean;
}

export class UpdatePartNumberDto {
  @IsNotEmpty()
  @IsString()
  client_part_number: string;
}

export class PublicDeploymentUpdateDto {
  @IsNotEmpty()
  @IsString()
  organization_name: string;

  @IsNotEmpty()
  @IsString()
  location_name: string;

  @IsOptional()
  @IsString()
  deployment_notes?: string;

  @IsNotEmpty()
  @IsEmail()
  verification_email: string;
}
