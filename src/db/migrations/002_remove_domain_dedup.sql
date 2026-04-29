-- Remove the unique constraint on (domain, pipeline_run_id) to allow
-- multiple contacts per company domain in a single pipeline run.
ALTER TABLE processed_companies
  DROP CONSTRAINT IF EXISTS processed_companies_domain_pipeline_run_id_key;

-- Also drop the old-style unique index name if it exists
DROP INDEX IF EXISTS processed_companies_domain_pipeline_run_id_key;
