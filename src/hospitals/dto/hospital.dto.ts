import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateSurgicalOperationDto {
  @IsString() @MinLength(1) @MaxLength(120) name_en: string;
  @IsString() @MinLength(1) @MaxLength(120) name_ar: string;
  @IsUUID() speciality_id: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

export class UpdateSurgicalOperationDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name_en?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name_ar?: string;
  @IsOptional() @IsUUID() speciality_id?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

export class UpdateHospitalDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(500) location?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
}

const APPROVAL = ['pending', 'approved', 'rejected'] as const;

export class AdminHospitalDto extends UpdateHospitalDto {
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsIn(APPROVAL) approval_status?: (typeof APPROVAL)[number];
}

export class CreateHospitalDto {
  @IsString() @MinLength(1) @MaxLength(160) name: string;
  /** When set, a hospital login account is created with the default password. */
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(500) location?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

export class InviteDoctorDto {
  @IsUUID() doctor_id: string;
}

export class HospitalOverrideInput {
  @IsOptional() @IsUUID() operation_id?: string | null;
  @Matches(DATE) start_date: string;
  @Matches(DATE) end_date: string;
  @IsBoolean() is_closed: boolean;
  @IsOptional() @Matches(TIME) start_time?: string | null;
  @IsOptional() @Matches(TIME) end_time?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() slot_minutes?: number | null;
  @IsOptional() @IsString() @MaxLength(200) note?: string | null;
}

export class ReplaceHospitalOverridesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HospitalOverrideInput)
  items: HospitalOverrideInput[];
}

export class HospitalSlotInput {
  @IsUUID() operation_id: string;
  @Type(() => Number) @IsInt() day_of_week: number;
  @Matches(TIME) start_time: string;
  @Matches(TIME) end_time: string;
  @Type(() => Number) @IsInt() slot_minutes: number;
}

export class ReplaceHospitalSlotsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HospitalSlotInput)
  items: HospitalSlotInput[];
}

export class CreateSurgeryReservationDto {
  @IsUUID() hospital_id: string;
  @IsUUID() operation_id: string;
  @IsUUID() doctor_id: string;
  @Matches(DATE) date: string;
  @Matches(TIME) time: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class RespondLinkDto {
  @IsIn(['approved', 'rejected']) status: 'approved' | 'rejected';
}

export class DecideReservationDto {
  @IsIn(['approved', 'rejected']) status: 'approved' | 'rejected';
}
