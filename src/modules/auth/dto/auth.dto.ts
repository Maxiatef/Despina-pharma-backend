import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() @MaxLength(200) password: string;
  @ApiPropertyOptional() @IsOptional() @IsString() mfaCode?: string;
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
  @ApiProperty() @IsString() code: string;
}

export class ForgotDto {
  @ApiProperty() @IsEmail() email: string;
}
