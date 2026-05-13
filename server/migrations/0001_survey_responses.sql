-- =============================================================================
-- 0031_survey_responses.sql
-- =============================================================================
-- LexDraft practitioner study - public market-research questionnaire served
-- at /survey on the unauthenticated public route. One row per submission.
--
-- Merges the questions from Legal_AI_Survey.md (v1 reference) with the
-- richer lexdraft-survey.md specification (authoritative; cohort-driven,
-- slug values, Tamil Nadu + neighbouring states audience). The lexdraft
-- spec is a strict superset content-wise: every Legal_AI_Survey topic
-- maps to an equivalent or richer lexdraft question, so the merged form
-- is the lexdraft form with no duplicates.
--
-- Column shape:
--   * Single-choice answers → text with a CHECK constraint listing the
--     valid slug values. Required questions are NOT NULL.
--   * Multi-select answers → jsonb storing an ordered array of slugs
--     (e.g. ["chatgpt","claude"]). A type guard plus a per-element
--     containment check enforces both shape and domain. Required multis
--     additionally enforce >= 1 element.
--   * Free-text answers → text. Required ones NOT NULL.
--   * "Other" reveal text fields → a single jsonb `other_texts` column
--     keyed by field name (e.g. `{"forum":"Madurai Bench rough notes"}`).
--     One column instead of one-per-question keeps the schema readable.
--   * Step 7 ranked list (top-3 time-consuming tasks) → jsonb array of
--     up to 3 distinct slugs, ordered by priority.
--
-- Branching CHECK constraints (defence-in-depth; React form hides hidden
-- fields and the Zod schema in survey.routes.ts rejects them, but the DB
-- is the third line of defence):
--
--   firm_size = 'large'             ↔ procurement may be present
--   firm_size IN ('small','medium') ↔ decision (jsonb) may be present
--   firm_size = 'solo'              ↔ decision_solo may be present
--   firm_size = 'solo'              → firm_departments must be NULL
--   ai_usage IN ('daily','weekly','occasional','stopped')
--                                   ↔ ai_tools may be present
--   ai_usage IN ('stopped','occasional')
--                                   ↔ stop_reason may be present
--   interview/beta/pilot/founder_call are independently optional
--
-- Submission metadata (submitted_at / ip_address / user_agent) is set
-- server-side from req.ip and req.headers; the client never sets them.
-- =============================================================================

create table if not exists survey_responses (
  id                  uuid primary key default gen_random_uuid(),
  submitted_at        timestamptz not null default now(),
  ip_address          inet,
  user_agent          text,

  -- Step 2 - PII -------------------------------------------------------------
  name                text not null,
  email               text not null,
  phone               text not null,
  city                text not null,
  bar_council         text not null,

  -- Step 3 - Role, years, firm size (cohort) ---------------------------------
  role                text not null,
  years               text not null,
  firm_size           text not null,    -- this column IS the cohort

  -- Step 4 - Cohort-dependent ------------------------------------------------
  firm_departments    text,             -- small/medium/large only
  support_staff       text,             -- all cohorts (different scale per cohort)
  procurement         text,             -- large only
  decision            jsonb,            -- small/medium only - multi
  decision_solo       text,             -- solo only

  -- Step 5 - Practice profile ------------------------------------------------
  language            jsonb not null,
  forum               jsonb not null,
  practice            jsonb not null,
  clients             jsonb not null,

  -- Step 6 - Current tool stack ----------------------------------------------
  research            jsonb not null,
  drafting            jsonb not null,
  storage             jsonb not null,
  case_mgmt           text,
  case_mgmt_spec      text,
  efile               jsonb,

  -- Step 7 - Where the time goes ---------------------------------------------
  pain_open           text  not null,
  rankings            jsonb not null,   -- ordered top-3 task slugs
  hurdle              jsonb not null,
  admin_hours         text  not null,

  -- Step 8 - AI usage history ------------------------------------------------
  ai_usage            text  not null,
  ai_tools            jsonb,
  stop_reason         jsonb,
  ai_wants            text  not null,
  ai_wish             text,

  -- Step 9 - Pricing & value -------------------------------------------------
  spend               text  not null,   -- cohort-scoped slug (see Q25 table)
  will_pay            text  not null,   -- cohort-scoped slug (see Q26 table)
  pricing_model       jsonb not null,
  switching           jsonb,

  -- Step 10 - Trust & concerns -----------------------------------------------
  concern             jsonb not null,
  data_location       text  not null,
  recommended         text  not null,

  -- Step 11 - Follow-up opt-ins (all optional) -------------------------------
  interview           text,
  beta                text,
  pilot               text,
  founder_call        text,

  -- Per-question "Other" free-text capture (keyed by field name) ------------
  other_texts         jsonb not null default '{}'::jsonb,

  -- ---------- Single-choice domains ---------------------------------------
  constraint survey_bar_council_chk check (bar_council in (
    'tamil-nadu-puducherry','karnataka','andhra-pradesh','telangana','kerala','other'
  )),
  constraint survey_role_chk check (role in (
    'designated-senior','senior-partner','partner','senior-associate','associate',
    'junior','solo-own','solo-under-senior','in-house','other'
  )),
  constraint survey_years_chk check (years in ('0-2','3-5','6-10','11-20','20+')),
  constraint survey_firm_size_chk check (firm_size in ('solo','small','medium','large')),
  constraint survey_procurement_chk check (procurement is null or procurement in (
    'central-it','practice-group','rfp','partner','dont-know'
  )),
  constraint survey_decision_solo_chk check (decision_solo is null or decision_solo in (
    'fully','consult','follow'
  )),
  constraint survey_support_staff_chk check (support_staff is null or support_staff in (
    '0','1-3','4-10','10+','1-2','3-5','5+'
  )),
  constraint survey_case_mgmt_chk check (case_mgmt is null or case_mgmt in ('yes','no','unsure')),
  constraint survey_admin_hours_chk check (admin_hours in ('<1','1-2','2-4','4+')),
  constraint survey_ai_usage_chk check (ai_usage in (
    'daily','weekly','occasional','stopped','never','unsure'
  )),
  constraint survey_data_location_chk check (data_location in (
    'india-strict','india','encrypted','onprem','unsure'
  )),
  constraint survey_recommended_chk check (recommended in (
    'very-likely','likely','neutral','unlikely','very-unlikely'
  )),
  constraint survey_interview_chk    check (interview    is null or interview    in ('yes','no')),
  constraint survey_beta_chk         check (beta         is null or beta         in ('yes','no')),
  constraint survey_pilot_chk        check (pilot        is null or pilot        in ('yes','maybe','no')),
  constraint survey_founder_call_chk check (founder_call is null or founder_call in ('yes','no')),

  -- Cohort-spend / cohort-willPay - the slugs are NOT portable across cohorts
  -- (a `<25k` slug means different things for solo vs small). The CHECK
  -- includes the union of all per-cohort slugs and we rely on the API's
  -- cohort-aware Zod schema (and the form) to never submit a wrong-cohort
  -- value. This keeps the DB constraint maintainable.
  constraint survey_spend_chk check (spend in (
    '<10k','10-25k','25-50k','50k-1L','1L+','na',
    '<25k','1-3L','3-10L','10L+',
    '<1L','10-25L','25L+',
    '<5L','5-10L','25L-1Cr','1Cr+'
  )),
  constraint survey_will_pay_chk check (will_pay in (
    '<500','500-1000','1000-2500','2500-5000','5000+','free-only',
    '<1000','5000-10000','10000+',
    '<2500','10000-20000','20000+',
    '<5000','10000-25000','25000-50000','50000+','enterprise'
  )),

  -- ---------- Multi-select shape + domain ---------------------------------

  constraint survey_language_shape check (jsonb_typeof(language) = 'array' and jsonb_array_length(language) >= 1),
  constraint survey_language_dom check (language <@
    '["english","tamil","telugu","kannada","malayalam","hindi","urdu","other"]'::jsonb),

  constraint survey_forum_shape check (jsonb_typeof(forum) = 'array' and jsonb_array_length(forum) >= 1),
  constraint survey_forum_dom check (forum <@
    '["madras-hc-chennai","madras-hc-madurai","other-hc","sc","district","magistrate",
      "nclt","itat","drt","consumer","family","rera","cat-sat","ngt","arbitration",
      "lok-adalat","tax-authorities","other-forum"]'::jsonb),

  constraint survey_practice_shape check (
    jsonb_typeof(practice) = 'array'
    and jsonb_array_length(practice) >= 1
    and jsonb_array_length(practice) <= 5
  ),
  constraint survey_practice_dom check (practice <@
    '["civil","criminal-def","criminal-pros","138","corporate","banking","ibc",
      "direct-tax","gst","ip","labour","family","real-estate","arbitration","writ",
      "service","consumer","cyber","white-collar","land-records","other-practice"]'::jsonb),

  constraint survey_clients_shape check (jsonb_typeof(clients) = 'array' and jsonb_array_length(clients) >= 1),
  constraint survey_clients_dom check (clients <@
    '["individuals","sme","midmarket","large-corp","govt","referral","startups","ngo","pro-bono"]'::jsonb),

  constraint survey_research_shape check (jsonb_typeof(research) = 'array' and jsonb_array_length(research) >= 1),
  constraint survey_research_dom check (research <@
    '["scc","scc-ai","manupatra","manupatra-ai","westlaw","lexis","air","taxmann",
      "kanoon","casemine","legitquest","supreme-today","vidur","bharatlaw","livelaw",
      "court-sites","physical","other-research"]'::jsonb),

  constraint survey_drafting_shape check (jsonb_typeof(drafting) = 'array' and jsonb_array_length(drafting) >= 1),
  constraint survey_drafting_dom check (drafting <@
    '["word-templates","word-fresh","gdocs","ai-direct","ai-embedded","handwritten","dictation","other"]'::jsonb),

  constraint survey_storage_shape check (jsonb_typeof(storage) = 'array' and jsonb_array_length(storage) >= 1),
  constraint survey_storage_dom check (storage <@
    '["local","physical","gdrive","gworkspace","onedrive","dropbox","onprem","dms",
      "indian-pms","whatsapp","email","other"]'::jsonb),

  constraint survey_efile_shape check (efile is null or jsonb_typeof(efile) = 'array'),
  constraint survey_efile_dom check (efile is null or efile <@
    '["ecourts","madras-hc","sc-efile","nclt","itat","drt","gst","it","mca","rera",
      "other-efile","none-efile"]'::jsonb),

  constraint survey_decision_shape check (decision is null or (
    jsonb_typeof(decision) = 'array' and jsonb_array_length(decision) >= 1
  )),
  constraint survey_decision_dom check (decision is null or decision <@
    '["managing-partner","committee","each-partner","practice-head","ops-finance","me","dont-know"]'::jsonb),

  constraint survey_rankings_shape check (
    jsonb_typeof(rankings) = 'array'
    and jsonb_array_length(rankings) >= 1
    and jsonb_array_length(rankings) <= 3
  ),
  constraint survey_rankings_dom check (rankings <@
    '["research","petitions","notices","contracts","review","chronology","summary",
      "translation","cause-list","client-comm","filing","billing","org","juniors"]'::jsonb),

  constraint survey_ai_tools_shape check (ai_tools is null or (
    jsonb_typeof(ai_tools) = 'array' and jsonb_array_length(ai_tools) >= 1
  )),
  constraint survey_ai_tools_dom check (ai_tools is null or ai_tools <@
    '["chatgpt","claude","gemini","copilot","perplexity","scc-ai","manupatra-ai",
      "amicus","legitquest","vidur","bharatlaw","harvey","lexis","cocounsel",
      "free-india","other-ai"]'::jsonb),

  constraint survey_stop_reason_shape check (stop_reason is null or (
    jsonb_typeof(stop_reason) = 'array' and jsonb_array_length(stop_reason) >= 1
  )),
  constraint survey_stop_reason_dom check (stop_reason is null or stop_reason <@
    '["hallucination","outdated","privacy","bar-rules","court-reception","liability",
      "conventions","cost","verify","workflow","seniors","other"]'::jsonb),

  constraint survey_concern_shape check (jsonb_typeof(concern) = 'array' and jsonb_array_length(concern) >= 1),
  constraint survey_concern_dom check (concern <@
    '["hallucination","confidentiality","bar-rules","liability","cost","learning",
      "seniors","integration","infrastructure","juniors-skill","other"]'::jsonb),

  constraint survey_hurdle_shape check (jsonb_typeof(hurdle) = 'array' and jsonb_array_length(hurdle) >= 1),
  constraint survey_hurdle_dom check (hurdle <@
    '["time","info","repetitive","juniors","court-infra","clients","updates","payments","other"]'::jsonb),

  constraint survey_pricing_model_shape check (jsonb_typeof(pricing_model) = 'array' and jsonb_array_length(pricing_model) >= 1),
  constraint survey_pricing_model_dom check (pricing_model <@
    '["monthly","annual","firm-flat","usage","freemium","tiered","one-time"]'::jsonb),

  constraint survey_switching_shape check (switching is null or (
    jsonb_typeof(switching) = 'array' and jsonb_array_length(switching) >= 1
  )),
  constraint survey_switching_dom check (switching is null or switching <@
    '["immediate","backup","parallel","junior-first","disruptive","trust-current"]'::jsonb),

  -- ---------- Cohort gates -------------------------------------------------

  -- Step 4 firm variant has firm_departments; solo variant must not.
  constraint survey_firm_departments_cohort check (
    case when firm_size = 'solo' then firm_departments is null else true end
  ),

  -- procurement is large-only.
  constraint survey_procurement_cohort check (
    case when firm_size = 'large' then true else procurement is null end
  ),

  -- decision (multi) is small/medium-only.
  constraint survey_decision_cohort check (
    case when firm_size in ('small','medium') then true else decision is null end
  ),

  -- decisionSolo is solo-only.
  constraint survey_decision_solo_cohort check (
    case when firm_size = 'solo' then true else decision_solo is null end
  ),

  -- ---------- AI-usage branching ------------------------------------------

  constraint survey_ai_tools_branching check (
    case
      when ai_usage in ('daily','weekly','occasional','stopped') then true
      else ai_tools is null
    end
  ),
  constraint survey_stop_reason_branching check (
    case
      when ai_usage in ('stopped','occasional') then true
      else stop_reason is null
    end
  ),

  -- ---------- Misc shape ---------------------------------------------------

  constraint survey_email_nonempty check (length(btrim(email)) > 0),
  constraint survey_other_texts_obj check (jsonb_typeof(other_texts) = 'object')
);

create index if not exists survey_responses_submitted_at_idx
  on survey_responses (submitted_at desc);

create index if not exists survey_responses_cohort_idx
  on survey_responses (firm_size, submitted_at desc);

-- Lower-cased email for dedup investigations / contact follow-up. Not unique:
-- a single email may have valid reasons to retake the survey.
create index if not exists survey_responses_email_idx
  on survey_responses (lower(email));
