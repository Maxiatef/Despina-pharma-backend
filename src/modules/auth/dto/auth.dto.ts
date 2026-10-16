import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() @MaxLength(200) password: string;
  @ApiPropertyOptional({ description: '6-digit app code or a backup code' }) @IsOptional() @IsString() @MaxLength(20) mfaCode?: string;
}

export class TokenPasswordDto {
  @ApiProperty() @IsString() token: string;
  @ApiProperty({ minLength: 10 }) @IsString() @MinLength(10) @MaxLength(200) password: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() currentPassword: string;
  @ApiProperty({ minLength: 10 }) @IsString() @MinLength(10) @MaxLength(200) newPassword: string;
}

export class CodeDto {
  @ApiProperty() @IsString() @MaxLength(20) code: string;
}

export class ForgotDto {
  @ApiProperty() @IsEmail() email: string;
}
