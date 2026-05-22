-- =============================================================================
-- 0003_survey_idempotency.sql
-- =============================================================================
-- Idempotency for POST /api/survey. The client sends a stable UUID (its
-- draft id, falling back to a fresh randomUUID) as the `Idempotency-Key`
-- header. If a network retry replays the same submission, the unique index
-- below collapses the second insert and the service returns the original
-- row's id instead of creating a duplicate.
--
-- Nullable so already-recorded responses (created before this column existed)
-- don't conflict with one another.
-- =============================================================================

alter table survey_responses
  add column if not exists idempotency_key uuid;

create unique index if not exists survey_responses_idempotency_key_uidx
  on survey_responses (idempotency_key)
  where idempotency_key is not null;
