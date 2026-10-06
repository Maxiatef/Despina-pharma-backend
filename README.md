# Despina Pharma – Backend API

NestJS 12 + TypeORM + PostgreSQL. Serves the website forms, the staff lead dashboard,
the customer workspace and the catalog CMS.

## Setup

```bash
npm install
cp .env.example .env        # fill in DB_*, APP_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm run migration:run       # create / update tables
npm run seed                # catalog (972 items), 16 services, stage template, first admin
npm run start:dev           # http://localhost:3000/api   docs: /api/docs
```

## Project layout

```
src/
  main.ts, app.module.ts
  config/            env validation (app refuses to start with bad config)
  common/            enums, decorators (@Public, @Roles, @StaffOnly, @CurrentUser), filters, utils
  database/
    data-source.ts   TypeORM connection (also used by the migration CLI)
    migrations/      versioned SQL migrations
    entities/        one file per table, with ManyToOne/OneToMany relations = the real foreign keys
    seed.ts
  modules/
    auth, users, companies, contacts, consents
    catalog, content (services / faqs / redirects)
    inquiries, tasks, documents (uploads + files), dashboard
    projects, stage-templates, briefs, samples, quotes, approvals, messages, portal
    email (queue + providers/ – Resend placeholder), audit, rate-limit, health
```

`npm run smoke` runs the end-to-end test against a running API (124 checks; cleans up its own data).
`npm run check:schema` compares every entity column and relation with the live database (read-only).

## Email – NOT CONNECTED YET (Resend later)

`EMAIL_PROVIDER=none`: every email is written to `email_jobs` (status `queued`) and only
logged. Nothing is sent. When Resend is added, queued emails go out automatically.
Steps: see `src/modules/email/providers/resend.provider.ts` (search for `TODO(resend)`).

## Other open items

- `TODO(storage)`: files are stored on local disk (`STORAGE_DIR`); add S3/R2 for production.
- `TODO(scan)`: no virus scanner yet. `SCAN_MODE=manual` keeps files `pending` until staff
  release them (`POST /api/document-versions/:id/scan`).
- Inbound email replies → messages: `WorkspaceService.recordInboundReply` (wire to Resend inbound).

## API map (`/api/...`)

| Area | Endpoints |
|---|---|
| Health | `GET health` |
| Public forms | `POST inquiries` (all 6 forms) · `POST project-briefs` · `POST sample-requests` |
| Uploads | `POST uploads/initiate` → `PUT uploads/:id/content` → `POST uploads/complete` |
| Public content | `GET public/catalog/categories[/:slug]` · `public/catalog/items[?q,category,kind,subgroup,source,sort,page]` · `public/catalog/categories/:cat/items/:slug` · `public/services[/:slug]` · `public/faqs` · `public/redirects/resolve?path=` |
| Auth | `POST auth/login` · `logout` · `GET auth/me` · `POST auth/mfa/setup|enable|disable` · `accept-invite` · `password/forgot|reset|change` |
| Leads (staff) | `GET inquiries` (table) · `inquiries/board` · `inquiries/summary` · `inquiries/export.csv` · `GET inquiries/:id` (with timeline) · `PATCH :id/status` · `POST :id/assign` · `DELETE :id/assign` · `POST :id/notes` · `GET/POST :id/messages` · `POST :id/convert` |
| Tasks (staff) | `GET/POST tasks` · `PATCH/DELETE tasks/:id` · `POST tasks/:id/complete|reopen` · `POST tasks/send-overdue-digest` |
| People | `companies` (+ `/:id/members`) · `contacts` · `users` (`POST users/invite`, admin only) |
| Projects | `GET/POST projects` · `GET/PATCH projects/:id` · `GET projects/:id/timeline` · `POST projects/:id/stages/:stageId/complete` |
| Products | `POST projects/:id/products` ("Add to project") · `PATCH/DELETE project-products/:id` |
| Briefs | `GET/POST project-products/:id/briefs` · `GET briefs/:id` · `POST briefs/:id/versions` |
| Samples | `GET/POST project-products/:id/samples` · `GET/PATCH samples/:id` · `POST samples/:id/revisions` · `PATCH sample-revisions/:id` · `POST sample-revisions/:id/feedback` |
| Quotes | `GET/POST projects/:id/quotes` · `GET/PATCH quotes/:id` · `POST quotes/:id/versions` · `POST quotes/:id/send` |
| Approvals | `GET/POST projects/:id/approvals` (bound to one exact version + hash) |
| Messages | `GET/POST projects/:id/messages` |
| Documents | `GET projects/:id/documents` · `GET inquiries/:id/documents` · `GET/PATCH documents/:id` · `POST document-versions/:id/download-link` · `GET files/:versionId?exp&sig` |
| Admin CMS | `admin/catalog/categories|sources|items` · `admin/services` · `admin/faqs` · `admin/redirects` |
| Stage templates | `GET/POST/PATCH stage-templates` |
| Email | `GET email-jobs` · `GET email-jobs/:id/events` · `POST email-jobs/:id/retry` · `POST webhooks/email-events` |
| Audit | `GET audit-events` (admin) |

Roles: `admin`, `sales`, `rnd`, `packaging`, `quality`, `production` (staff) and `customer`.
Customers only see projects of companies they belong to, and only `customer`-visible documents.
The "Quality Release" stage can only be completed by `quality` (or `admin`).
