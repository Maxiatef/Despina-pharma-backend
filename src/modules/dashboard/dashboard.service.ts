import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';

/** Numbers for the staff home screen. Read-only aggregate queries. */
@Injectable()
export class DashboardService {
  constructor(private readonly ds: DataSource) {}

  async overview(user: AuthUser) {
    const [leads, myWork, projects, emails, recent, bySource, openTasks] = await Promise.all([
      this.ds.query(`
        SELECT
          count(*) FILTER (WHERE status = 'new')::int AS new,
          count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS last_7_days,
          count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS last_30_days,
          count(*) FILTER (WHERE status = 'won')::int AS won,
          count(*) FILTER (WHERE status = 'lost')::int AS lost,
          count(*) FILTER (WHERE status NOT IN ('won','lost','closed','not_a_fit')
            AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.inquiry_id = inquiries.id AND a.unassigned_at IS NULL))::int AS unassigned
        FROM inquiries`),
      this.ds.query(
        `SELECT
           (SELECT count(*)::int FROM tasks WHERE assignee_id = $1 AND completed_at IS NULL) AS open_tasks,
           (SELECT count(*)::int FROM tasks WHERE assignee_id = $1 AND completed_at IS NULL AND due_at < now()) AS overdue_tasks,
           (SELECT count(*)::int FROM assignments a JOIN inquiries i ON i.id = a.inquiry_id
              WHERE a.user_id = $1 AND a.unassigned_at IS NULL AND i.status NOT IN ('won','lost','closed','not_a_fit')) AS my_open_leads,
           (SELECT count(*)::int FROM tasks WHERE completed_at IS NULL) AS all_open_tasks,
           (SELECT count(*)::int FROM tasks WHERE completed_at IS NULL AND due_at < now()) AS all_overdue_tasks,
           (SELECT count(*)::int FROM tasks WHERE completed_at IS NULL AND assignee_id IS NULL) AS unassigned_tasks`,
        [user.id],
      ),
      this.ds.query(`
        SELECT p.status, count(*)::int AS count FROM projects p GROUP BY p.status`),
      this.ds.query(`
        SELECT status, count(*)::int AS count FROM email_jobs WHERE created_at > now() - interval '30 days' GROUP BY status`),
      this.ds.query(`
        SELECT i.id, i.reference_no, i.form_type, i.status, i.created_at, c.first_name, c.last_name, co.name AS company
        FROM inquiries i JOIN contacts c ON c.id = i.contact_id LEFT JOIN companies co ON co.id = i.company_id
        ORDER BY i.created_at DESC LIMIT 10`),
      this.ds.query(`
        SELECT form_type, count(*)::int AS count FROM inquiries
        WHERE created_at > now() - interval '30 days' GROUP BY form_type ORDER BY count DESC`),
      this.ds.query(
        `SELECT t.id, t.title, t.priority, t.due_at, t.inquiry_id, t.project_id, t.assignee_id, u.email AS assignee_email,
                i.reference_no, p.code AS project_code
         FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
         LEFT JOIN inquiries i ON i.id = t.inquiry_id LEFT JOIN projects p ON p.id = t.project_id
         WHERE t.completed_at IS NULL AND (t.assignee_id = $1 OR t.assignee_id IS NULL)
         ORDER BY t.due_at ASC NULLS LAST LIMIT 8`,
        [user.id],
      ),
    ]);
    return {
      leads: leads[0],
      myWork: myWork[0],
      projectsByStatus: Object.fromEntries(projects.map((r: { status: string; count: number }) => [r.status, r.count])),
      emailsLast30Days: Object.fromEntries(emails.map((r: { status: string; count: number }) => [r.status, r.count])),
      leadsByFormLast30Days: bySource,
      recentLeads: recent,
      openTasks,
    };
  }

  /** Leads per week for the last N weeks (for a chart). */
  leadsPerWeek(weeks = 12) {
    return this.ds.query(
      `SELECT to_char(date_trunc('week', g), 'YYYY-MM-DD') AS week,
              (SELECT count(*)::int FROM inquiries WHERE date_trunc('week', created_at) = date_trunc('week', g)) AS count
       FROM generate_series(now() - ($1 || ' weeks')::interval, now(), interval '1 week') g
       ORDER BY week`,
      [String(weeks)],
    );
  }
}
