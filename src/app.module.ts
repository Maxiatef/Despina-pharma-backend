import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from './database/data-source.js';
import { validateEnv } from './config/env.validation.js';

// Infrastructure (global)
import { AuditModule } from './modules/audit/audit.module.js';
import { RateLimitModule } from './modules/rate-limit/rate-limit.module.js';
import { EmailModule } from './modules/email/email.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';

// People
import { UsersModule } from './modules/users/users.module.js';
import { CompaniesModule } from './modules/companies/companies.module.js';
import { ContactsModule } from './modules/contacts/contacts.module.js';
import { ConsentsModule } from './modules/consents/consents.module.js';

// Website content
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { ContentModule } from './modules/content/content.module.js';

// Phase 1 – inquiries & leads
import { InquiriesModule } from './modules/inquiries/inquiries.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';

// Phase 2 – customer workspace
import { ProjectsModule } from './modules/projects/projects.module.js';
import { StageTemplatesModule } from './modules/stage-templates/stage-templates.module.js';
import { BriefsModule } from './modules/briefs/briefs.module.js';
import { SamplesModule } from './modules/samples/samples.module.js';
import { QuotesModule } from './modules/quotes/quotes.module.js';
import { ApprovalsModule } from './modules/approvals/approvals.module.js';
import { MessagesModule } from './modules/messages/messages.module.js';
import { PortalModule } from './modules/portal/portal.module.js';

// Scheduled jobs (Vercel Cron)
import { CronModule } from './modules/cron/cron.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    TypeOrmModule.forRoot(dataSourceOptions),

    AuditModule,
    RateLimitModule,
    EmailModule,
    AuthModule,
    HealthModule,

    UsersModule,
    CompaniesModule,
    ContactsModule,
    ConsentsModule,

    CatalogModule,
    ContentModule,

    InquiriesModule,
    TasksModule,
    DocumentsModule,
    DashboardModule,

    ProjectsModule,
    StageTemplatesModule,
    BriefsModule,
    SamplesModule,
    QuotesModule,
    ApprovalsModule,
    MessagesModule,
    PortalModule,

    CronModule,
  ],
})
export class AppModule {}
