import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

// "Report a problem" (the Sentry feedback widget). The widget files the report
// in Sentry; this copy is what reaches the team by email.
export class ProblemReportDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  // Sentry event id of the same report, so the screenshot can be found.
  @IsOptional()
  @Matches(/^[a-f0-9]{32}$/)
  eventId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  page?: string;
}
