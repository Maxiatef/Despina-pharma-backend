import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial Despina Pharma schema (Phase 1 + Phase 2).
 * - Every relation is a real FOREIGN KEY (DBeaver shows linked values).
 * - Every fixed list of values is a PostgreSQL ENUM (DBeaver shows a dropdown).
 */
export class InitialSchema1759700000000 implements MigrationInterface {
  name = 'InitialSchema1759700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // ---------- ENUMS ----------
    await q.query(`
      CREATE TYPE user_role AS ENUM ('admin','sales','rnd','packaging','quality','production','customer');
      CREATE TYPE member_role AS ENUM ('owner','member','viewer');
      CREATE TYPE catalog_item_kind AS ENUM ('stock-reference','concept','base','development-program','despina-formula');
      CREATE TYPE form_type AS ENUM ('contact','new_customer','new_product','sample_request','sample_feedback','service');
      CREATE TYPE inquiry_status AS ENUM ('new','assigned','awaiting_customer','qualified','quoted','won','lost','closed','not_a_fit');
      CREATE TYPE task_priority AS ENUM ('low','normal','high','urgent');
      CREATE TYPE document_visibility AS ENUM ('internal','customer');
      CREATE TYPE scan_status AS ENUM ('pending','clean','infected','failed');
      CREATE TYPE email_kind AS ENUM ('owner_notice','customer_ack','staff_alert','message_notice','quote_notice','invite','password_reset');
      CREATE TYPE email_job_status AS ENUM ('queued','sending','sent','failed');
      CREATE TYPE email_event_type AS ENUM ('delivered','bounced','complaint','failed','opened','unsubscribed');
      CREATE TYPE consent_type AS ENUM ('privacy','marketing','terms');
      CREATE TYPE project_status AS ENUM ('active','on_hold','completed','cancelled');
      CREATE TYPE sample_status AS ENUM ('requested','in_development','shipped','feedback_received','approved','rejected');
      CREATE TYPE quote_status AS ENUM ('draft','sent','accepted','rejected','expired');
      CREATE TYPE approval_target AS ENUM ('document_version','sample_revision','quote_version','brief_version');
      CREATE TYPE audit_entity AS ENUM ('company','contact','user','inquiry','project','document','sample','quote','approval','catalog_item','service','faq','settings');
    `);

    // ---------- PEOPLE ----------
    await q.query(`
      CREATE TABLE companies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(200) NOT NULL,
        website varchar(300),
        country varchar(100),
        industry varchar(150),
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE contacts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
        first_name varchar(100) NOT NULL,
        last_name varchar(100),
        email varchar(254) NOT NULL,
        phone varchar(50),
        job_title varchar(150),
        country varchar(100),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX ix_contacts_email ON contacts (lower(email));

      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
        email varchar(254) NOT NULL,
        password_hash varchar(255),
        role user_role NOT NULL DEFAULT 'customer',
        mfa_secret varchar(255),
        mfa_enabled boolean NOT NULL DEFAULT false,
        is_active boolean NOT NULL DEFAULT true,
        last_login_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX ux_users_email ON users (lower(email));

      CREATE TABLE company_memberships (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        member_role member_role NOT NULL DEFAULT 'member',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (user_id, company_id)
      );

      CREATE TABLE sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash varchar(255) NOT NULL UNIQUE,
        ip inet,
        user_agent text,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    // ---------- CATALOG & CONTENT ----------
    await q.query(`
      CREATE TABLE catalog_categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug varchar(150) NOT NULL UNIQUE,
        title varchar(200) NOT NULL,
        description text,
        sort_order int NOT NULL DEFAULT 0,
        is_published boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE catalog_sources (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(50) NOT NULL UNIQUE,
        name varchar(200) NOT NULL,
        website varchar(300),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE catalog_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        category_id uuid NOT NULL REFERENCES catalog_categories(id) ON DELETE RESTRICT,
        source_id uuid REFERENCES catalog_sources(id) ON DELETE SET NULL,
        slug varchar(200) NOT NULL,
        name varchar(300) NOT NULL,
        kind catalog_item_kind NOT NULL DEFAULT 'stock-reference',
        subgroup varchar(200),
        ingredients jsonb NOT NULL DEFAULT '[]',
        notes text,
        image_url varchar(500),
        seo_title varchar(200),
        seo_description varchar(400),
        is_published boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (category_id, slug)
      );

      CREATE TABLE services (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug varchar(150) NOT NULL UNIQUE,
        title varchar(200) NOT NULL,
        summary text,
        body text,
        sort_order int NOT NULL DEFAULT 0,
        is_published boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE faqs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        service_id uuid REFERENCES services(id) ON DELETE SET NULL,
        question text NOT NULL,
        answer text NOT NULL,
        topic varchar(100),
        sort_order int NOT NULL DEFAULT 0,
        is_published boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE redirects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        from_path varchar(500) NOT NULL UNIQUE,
        to_path varchar(500) NOT NULL,
        status_code smallint NOT NULL DEFAULT 301 CHECK (status_code IN (301,302,307,308)),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    // ---------- PHASE 2 CORE (needed by inquiries/tasks) ----------
    await q.query(`
      CREATE TABLE stage_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(150) NOT NULL UNIQUE,
        stages jsonb NOT NULL DEFAULT '[]',
        is_default boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE projects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(30) NOT NULL UNIQUE,
        company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        name varchar(200) NOT NULL,
        status project_status NOT NULL DEFAULT 'active',
        stage_template_id uuid REFERENCES stage_templates(id) ON DELETE SET NULL,
        current_stage_id uuid,
        owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
        source_inquiry_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE project_stages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name varchar(150) NOT NULL,
        sort_order int NOT NULL DEFAULT 0,
        requires_role user_role,
        started_at timestamptz,
        completed_at timestamptz,
        completed_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      ALTER TABLE projects ADD CONSTRAINT fk_projects_current_stage
        FOREIGN KEY (current_stage_id) REFERENCES project_stages(id) ON DELETE SET NULL;
    `);

    // ---------- PHASE 1: INQUIRIES ----------
    await q.query(`
      CREATE SEQUENCE inquiry_reference_seq START 1;

      CREATE TABLE inquiries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reference_no varchar(30) NOT NULL UNIQUE,
        form_type form_type NOT NULL,
        status inquiry_status NOT NULL DEFAULT 'new',
        contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
        company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
        message text,
        payload jsonb NOT NULL DEFAULT '{}',
        source_page varchar(500),
        idempotency_key varchar(100) NOT NULL UNIQUE,
        ip inet,
        user_agent text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX ix_inquiries_status ON inquiries (status);

      ALTER TABLE projects ADD CONSTRAINT fk_projects_source_inquiry
        FOREIGN KEY (source_inquiry_id) REFERENCES inquiries(id) ON DELETE SET NULL;

      CREATE TABLE inquiry_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        inquiry_id uuid NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
        catalog_item_id uuid REFERENCES catalog_items(id) ON DELETE SET NULL,
        service_id uuid REFERENCES services(id) ON DELETE SET NULL,
        quantity int,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE assignments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        inquiry_id uuid REFERENCES inquiries(id) ON DELETE CASCADE,
        project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
        unassigned_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (inquiry_id IS NOT NULL OR project_id IS NOT NULL)
      );

      CREATE TABLE tasks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        inquiry_id uuid REFERENCES inquiries(id) ON DELETE CASCADE,
        project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
        assignee_id uuid REFERENCES users(id) ON DELETE SET NULL,
        created_by uuid REFERENCES users(id) ON DELETE SET NULL,
        title varchar(300) NOT NULL,
        priority task_priority NOT NULL DEFAULT 'normal',
        due_at timestamptz,
        completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE status_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        inquiry_id uuid REFERENCES inquiries(id) ON DELETE CASCADE,
        project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
        actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
        from_status inquiry_status,
        to_status inquiry_status,
        note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        inquiry_id uuid REFERENCES inquiries(id) ON DELETE CASCADE,
        project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
        company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
        uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
        title varchar(300) NOT NULL,
        visibility document_visibility NOT NULL DEFAULT 'internal',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE document_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        version_no int NOT NULL DEFAULT 1,
        storage_key varchar(500) NOT NULL UNIQUE,
        original_filename varchar(300) NOT NULL,
        mime_type varchar(150) NOT NULL,
        size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
        sha256 char(64) NOT NULL,
        scan_status scan_status NOT NULL DEFAULT 'pending',
        uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (document_id, version_no)
      );

      CREATE TABLE email_jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        inquiry_id uuid REFERENCES inquiries(id) ON DELETE SET NULL,
        project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
        kind email_kind NOT NULL,
        to_email varchar(254) NOT NULL,
        subject varchar(300) NOT NULL,
        provider_message_id varchar(200),
        status email_job_status NOT NULL DEFAULT 'queued',
        attempts int NOT NULL DEFAULT 0,
        last_error text,
        sent_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE email_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email_job_id uuid NOT NULL REFERENCES email_jobs(id) ON DELETE CASCADE,
        event email_event_type NOT NULL,
        raw jsonb NOT NULL DEFAULT '{}',
        occurred_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE consent_records (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        inquiry_id uuid REFERENCES inquiries(id) ON DELETE SET NULL,
        consent_type consent_type NOT NULL,
        granted boolean NOT NULL,
        policy_version varchar(30),
        ip inet,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE rate_limits (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key varchar(200) NOT NULL,
        window_start timestamptz NOT NULL,
        count int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (key, window_start)
      );
    `);

    // ---------- PHASE 2: WORKSPACE ----------
    await q.query(`
      CREATE TABLE project_products (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        catalog_item_id uuid REFERENCES catalog_items(id) ON DELETE SET NULL,
        service_id uuid REFERENCES services(id) ON DELETE SET NULL,
        name varchar(300) NOT NULL,
        target_quantity int,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE briefs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_product_id uuid NOT NULL REFERENCES project_products(id) ON DELETE CASCADE,
        title varchar(300) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE brief_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        brief_id uuid NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
        version_no int NOT NULL DEFAULT 1,
        content jsonb NOT NULL DEFAULT '{}',
        created_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (brief_id, version_no)
      );

      CREATE TABLE samples (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_product_id uuid NOT NULL REFERENCES project_products(id) ON DELETE CASCADE,
        inquiry_id uuid REFERENCES inquiries(id) ON DELETE SET NULL,
        title varchar(300) NOT NULL,
        status sample_status NOT NULL DEFAULT 'requested',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE sample_revisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        sample_id uuid NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
        revision_no int NOT NULL DEFAULT 1,
        description text,
        shipped_at timestamptz,
        tracking_no varchar(100),
        created_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (sample_id, revision_no)
      );

      CREATE TABLE feedback (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        sample_revision_id uuid NOT NULL REFERENCES sample_revisions(id) ON DELETE CASCADE,
        author_id uuid REFERENCES users(id) ON DELETE SET NULL,
        inquiry_id uuid REFERENCES inquiries(id) ON DELETE SET NULL,
        rating smallint CHECK (rating BETWEEN 1 AND 5),
        comments text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE quotes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        quote_no varchar(30) NOT NULL UNIQUE,
        status quote_status NOT NULL DEFAULT 'draft',
        created_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE quote_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
        version_no int NOT NULL DEFAULT 1,
        currency char(3) NOT NULL DEFAULT 'USD',
        total numeric(14,2) NOT NULL DEFAULT 0,
        valid_until date,
        document_version_id uuid REFERENCES document_versions(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (quote_id, version_no)
      );

      CREATE TABLE quote_lines (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        quote_version_id uuid NOT NULL REFERENCES quote_versions(id) ON DELETE CASCADE,
        project_product_id uuid REFERENCES project_products(id) ON DELETE SET NULL,
        description varchar(500) NOT NULL,
        quantity numeric(14,2) NOT NULL DEFAULT 1,
        unit_price numeric(14,4) NOT NULL DEFAULT 0,
        line_total numeric(14,2) NOT NULL DEFAULT 0,
        sort_order int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE approvals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        target_type approval_target NOT NULL,
        document_version_id uuid REFERENCES document_versions(id) ON DELETE RESTRICT,
        sample_revision_id uuid REFERENCES sample_revisions(id) ON DELETE RESTRICT,
        quote_version_id uuid REFERENCES quote_versions(id) ON DELETE RESTRICT,
        brief_version_id uuid REFERENCES brief_versions(id) ON DELETE RESTRICT,
        target_hash char(64) NOT NULL,
        approver_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        approver_role user_role NOT NULL,
        confirmation_text text NOT NULL,
        approved_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (num_nonnulls(document_version_id, sample_revision_id, quote_version_id, brief_version_id) = 1)
      );

      CREATE TABLE messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
        inquiry_id uuid REFERENCES inquiries(id) ON DELETE CASCADE,
        sender_id uuid REFERENCES users(id) ON DELETE SET NULL,
        sender_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
        body text NOT NULL,
        via_email boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (project_id IS NOT NULL OR inquiry_id IS NOT NULL)
      );
    `);

    // ---------- SYSTEM ----------
    await q.query(`
      CREATE TABLE audit_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
        action varchar(100) NOT NULL,
        entity_type audit_entity NOT NULL,
        entity_id uuid,
        before jsonb,
        after jsonb,
        ip inet,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX ix_audit_entity ON audit_events (entity_type, entity_id);
    `);

    // ---------- updated_at trigger on every table ----------
    await q.query(`
      CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
      BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

      DO $$
      DECLARE t text;
      BEGIN
        FOR t IN SELECT table_name FROM information_schema.columns
                 WHERE table_schema = 'public' AND column_name = 'updated_at'
        LOOP
          EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I
                          FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
        END LOOP;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE IF EXISTS audit_events, messages, approvals, quote_lines, quote_versions, quotes,
        feedback, sample_revisions, samples, brief_versions, briefs, project_products,
        rate_limits, consent_records, email_events, email_jobs, document_versions, documents,
        status_events, tasks, assignments, inquiry_items, inquiries, project_stages, projects,
        stage_templates, redirects, faqs, services, catalog_items, catalog_sources,
        catalog_categories, sessions, company_memberships, users, contacts, companies CASCADE;
      DROP SEQUENCE IF EXISTS inquiry_reference_seq;
      DROP FUNCTION IF EXISTS set_updated_at();
      DROP TYPE IF EXISTS user_role, member_role, catalog_item_kind, form_type, inquiry_status,
        task_priority, document_visibility, scan_status, email_kind, email_job_status,
        email_event_type, consent_type, project_status, sample_status, quote_status,
        approval_target, audit_entity;
    `);
  }
}
