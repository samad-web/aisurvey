import { db } from '../db.js';
import type { SurveyResponseInput } from '../routes/survey.routes.js';

interface InsertMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export const surveyService = {
  async create(input: SurveyResponseInput, meta: InsertMeta): Promise<{ id: string }> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');

    const rows = await sql<{ id: string }[]>`
      insert into survey_responses (
        ip_address, user_agent,
        name, email, phone, city, bar_council,
        role, years, firm_size,
        firm_departments, support_staff, procurement, decision, decision_solo,
        language, forum, practice, clients,
        research, drafting, storage, case_mgmt, case_mgmt_spec, efile,
        pain_open, rankings, hurdle, admin_hours,
        ai_usage, ai_tools, stop_reason, ai_wants, ai_wish,
        spend, will_pay, pricing_model, switching,
        concern, data_location, recommended,
        interview, beta, pilot, founder_call,
        other_texts
      ) values (
        ${meta.ipAddress}, ${meta.userAgent},
        ${input.name}, ${input.email}, ${input.phone}, ${input.city}, ${input.barCouncil},
        ${input.role}, ${input.years}, ${input.firmSize},
        ${input.firmDepartments ?? null},
        ${input.supportStaff ?? null},
        ${input.procurement ?? null},
        ${input.decision ? sql.json(input.decision) : null},
        ${input.decisionSolo ?? null},
        ${sql.json(input.language)},
        ${sql.json(input.forum)},
        ${sql.json(input.practice)},
        ${sql.json(input.clients)},
        ${sql.json(input.research)},
        ${sql.json(input.drafting)},
        ${sql.json(input.storage)},
        ${input.caseMgmt ?? null},
        ${input.caseMgmtSpec ?? null},
        ${input.efile ? sql.json(input.efile) : null},
        ${input.painOpen},
        ${sql.json(input.rankings)},
        ${sql.json(input.hurdle)},
        ${input.adminHours},
        ${input.aiUsage},
        ${input.aiTools ? sql.json(input.aiTools) : null},
        ${input.stopReason ? sql.json(input.stopReason) : null},
        ${input.aiWants},
        ${input.aiWish ?? null},
        ${input.spend},
        ${input.willPay},
        ${sql.json(input.pricingModel)},
        ${input.switching ? sql.json(input.switching) : null},
        ${sql.json(input.concern)},
        ${input.dataLocation},
        ${input.recommended},
        ${input.interview ?? null},
        ${input.beta ?? null},
        ${input.pilot ?? null},
        ${input.founderCall ?? null},
        ${sql.json(input.otherTexts ?? {})}
      )
      returning id
    `;
    return rows[0]!;
  },
};
