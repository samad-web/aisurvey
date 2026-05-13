-- =============================================================================
-- 0032_survey_drafts.sql
-- =============================================================================
-- Anonymous in-progress drafts for the public /survey page. The user fills
-- the form across many screens; each answer change is debounce-synced to a
-- row in this table so a respondent who drops off mid-survey is still
-- captured. Completed submissions continue to land in survey_responses via
-- POST /api/survey (with all its strict CHECK constraints) - drafts are
-- scratch space and intentionally loose.
--
-- No tenant / no auth: the public survey is unauthenticated and a single
-- session may not yet have provided an email when the draft is first
-- created. The client generates nothing - the row's `id` (returned from
-- POST /api/survey/drafts) is stored in browser localStorage and used to
-- target subsequent PUTs.
--
-- Lifetime: drafts live until an admin purges them. A future migration can
-- add a TTL job (e.g. "delete drafts older than 60 days where
-- completed_at is null"). For now, retention is unbounded.
-- =============================================================================

create table if not exists survey_drafts (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  ip_address      inet,
  user_agent      text,

  -- Everything the user has typed so far. Shape mirrors what POST /api/survey
  -- would accept but with no constraints - partial / invalid is fine.
  answers         jsonb not null default '{}'::jsonb,
  other_texts    jsonb not null default '{}'::jsonb,

  -- Position in the visible-question list, for dropoff analytics:
  --   -1 = welcome screen, 0..N-1 = at question N
  current_index   int   not null default -1,

  -- Stamped when the user successfully submits the final response. The
  -- completed survey lives in survey_responses; this flag lets analytics
  -- distinguish "drafted-and-finished" from "drafted-and-abandoned" without
  -- joining tables.
  completed_at    timestamptz,

  constraint survey_drafts_answers_obj     check (jsonb_typeof(answers) = 'object'),
  constraint survey_drafts_other_texts_obj check (jsonb_typeof(other_texts) = 'object')
);

create index if not exists survey_drafts_updated_at_idx
  on survey_drafts (updated_at desc);

create index if not exists survey_drafts_incomplete_idx
  on survey_drafts (updated_at desc) where completed_at is null;
