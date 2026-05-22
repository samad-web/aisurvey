-- =============================================================================
-- 0004_ai_tools_draft_bot_pro.sql
-- =============================================================================
-- Widen survey_ai_tools_dom to allow the new 'draft-bot-pro' slug. Postgres
-- doesn't support ALTER CHECK in-place, so drop-and-recreate is the standard
-- pattern. Existing rows are re-validated against the new (looser) check at
-- recreate time; since every previously-allowed slug remains in the list,
-- the recheck cannot fail.
-- =============================================================================

alter table survey_responses
  drop constraint if exists survey_ai_tools_dom;

alter table survey_responses
  add constraint survey_ai_tools_dom check (
    ai_tools is null or ai_tools <@
      '["chatgpt","claude","gemini","copilot","perplexity","scc-ai","manupatra-ai",
        "amicus","legitquest","vidur","bharatlaw","harvey","lexis","cocounsel",
        "free-india","draft-bot-pro","other-ai"]'::jsonb
  );
