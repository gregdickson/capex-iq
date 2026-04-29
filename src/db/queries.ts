import { query } from './client.js';

// --- Pipeline Runs ---

export async function createPipelineRun(filename: string, totalRecords: number) {
  const result = await query<{ id: number }>(
    `INSERT INTO pipeline_runs (csv_filename, total_records)
     VALUES ($1, $2) RETURNING id`,
    [filename, totalRecords]
  );
  return result.rows[0].id;
}

export async function updatePipelineRunCounts(runId: number) {
  await query(
    `UPDATE pipeline_runs SET
       after_filter = (SELECT count(*) FROM processed_companies WHERE pipeline_run_id = $1 AND status != 'filtered' AND status != 'duplicate'),
       matched = (SELECT count(*) FROM processed_companies WHERE pipeline_run_id = $1 AND matched_at IS NOT NULL),
       no_match = (SELECT count(*) FROM processed_companies WHERE pipeline_run_id = $1 AND status = 'no_match'),
       qualified = (SELECT count(*) FROM processed_companies WHERE pipeline_run_id = $1 AND qualified_at IS NOT NULL),
       ai_validated = (SELECT count(*) FROM processed_companies WHERE pipeline_run_id = $1 AND ca_analysis IS NOT NULL),
       emails_generated = (SELECT count(*) FROM processed_companies WHERE pipeline_run_id = $1 AND emails_generated_at IS NOT NULL),
       ready_to_send = (SELECT count(*) FROM processed_companies WHERE pipeline_run_id = $1 AND status = 'ready_to_send'),
       sent = (SELECT count(*) FROM processed_companies WHERE pipeline_run_id = $1 AND status = 'sent'),
       failed = (SELECT count(*) FROM processed_companies WHERE pipeline_run_id = $1 AND status LIKE 'failed_%')
     WHERE id = $1`,
    [runId]
  );
}

export async function getPipelineRuns(limit = 50) {
  const result = await query(
    `SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function getPipelineRun(runId: number) {
  const result = await query(
    'SELECT * FROM pipeline_runs WHERE id = $1',
    [runId]
  );
  return result.rows[0] || null;
}

// --- Processed Companies ---

export interface InsertCompanyData {
  pipeline_run_id: number;
  domain: string;
  status: string;
  contact_email: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_full_name: string | null;
  contact_position: string | null;
  contact_seniority: string | null;
  contact_linkedin: string | null;
  org_name: string | null;
  org_size: string | null;
  org_city: string | null;
  org_country: string | null;
  org_industry: string | null;
}

export async function insertProcessedCompany(data: InsertCompanyData) {
  const result = await query<{ id: number }>(
    `INSERT INTO processed_companies (
       pipeline_run_id, domain, status,
       contact_email, contact_first_name, contact_last_name, contact_full_name,
       contact_position, contact_seniority, contact_linkedin,
       org_name, org_size, org_city, org_country, org_industry
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING id`,
    [
      data.pipeline_run_id, data.domain, data.status,
      data.contact_email, data.contact_first_name, data.contact_last_name, data.contact_full_name,
      data.contact_position, data.contact_seniority, data.contact_linkedin,
      data.org_name, data.org_size, data.org_city, data.org_country, data.org_industry,
    ]
  );
  return result.rows[0]?.id || null;
}

export async function updateCompanyStatus(
  id: number,
  status: string,
  data?: Record<string, any>
) {
  const setClauses = ['status = $2'];
  const params: any[] = [id, status];
  let paramIdx = 3;

  if (data) {
    for (const [key, value] of Object.entries(data)) {
      setClauses.push(`${key} = $${paramIdx}`);
      params.push(value);
      paramIdx++;
    }
  }

  await query(
    `UPDATE processed_companies SET ${setClauses.join(', ')} WHERE id = $1`,
    params
  );
}

export async function getRunSummary(runId: number) {
  const result = await query(
    `SELECT status, count(*)::int as count
     FROM processed_companies WHERE pipeline_run_id = $1
     GROUP BY status ORDER BY status`,
    [runId]
  );
  return result.rows;
}

export async function getRunCompanies(
  runId: number,
  statusFilter?: string,
  page = 1,
  pageSize = 50
) {
  const offset = (page - 1) * pageSize;
  const params: any[] = [runId, pageSize, offset];
  let whereClause = 'WHERE pipeline_run_id = $1';

  if (statusFilter) {
    whereClause += ' AND status = $4';
    params.push(statusFilter);
  }

  const result = await query(
    `SELECT * FROM processed_companies ${whereClause}
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    params
  );

  const countWhere = statusFilter
    ? 'WHERE pipeline_run_id = $1 AND status = $2'
    : 'WHERE pipeline_run_id = $1';
  const countResult = await query(
    `SELECT count(*)::int as total FROM processed_companies ${countWhere}`,
    statusFilter ? [runId, statusFilter] : [runId]
  );

  return {
    companies: result.rows,
    total: countResult.rows[0]?.total || 0,
    page,
    pageSize,
  };
}

export async function getFailedCompanies(page = 1, pageSize = 50) {
  const offset = (page - 1) * pageSize;
  const result = await query(
    `SELECT pc.*, pr.csv_filename
     FROM processed_companies pc
     JOIN pipeline_runs pr ON pr.id = pc.pipeline_run_id
     WHERE pc.status LIKE 'failed_%'
     ORDER BY pc.created_at DESC LIMIT $1 OFFSET $2`,
    [pageSize, offset]
  );

  const countResult = await query(
    "SELECT count(*)::int as total FROM processed_companies WHERE status LIKE 'failed_%'"
  );

  return {
    companies: result.rows,
    total: countResult.rows[0]?.total || 0,
    page,
    pageSize,
  };
}

export async function getReadyToSend(limit: number) {
  const result = await query(
    `SELECT * FROM processed_companies
     WHERE status = 'ready_to_send'
     ORDER BY created_at ASC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function getSentTodayCount(): Promise<number> {
  const result = await query<{ count: number }>(
    "SELECT count(*)::int as count FROM processed_companies WHERE sent_at::date = CURRENT_DATE"
  );
  return result.rows[0].count;
}

export async function checkDomainProcessed(domain: string, windowDays: number): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM processed_companies
       WHERE domain = $1
       AND created_at > NOW() - INTERVAL '1 day' * $2
       AND status NOT LIKE 'failed_%'
     ) as exists`,
    [domain, windowDays]
  );
  return result.rows[0].exists;
}

export async function getRetriableFailures(maxRetries = 3) {
  const result = await query(
    `SELECT * FROM processed_companies
     WHERE status IN ('failed_matching', 'failed_qualification', 'failed_email_generation', 'failed_ghl_push')
     AND retry_count < $1
     ORDER BY created_at ASC`,
    [maxRetries]
  );
  return result.rows;
}

export async function getCompanyById(id: number) {
  const result = await query(
    'SELECT * FROM processed_companies WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}
