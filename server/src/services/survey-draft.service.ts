import { db } from '../db.js';

interface CreateMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

interface DraftPatch {
  answers?: Record<string, unknown>;
  otherTexts?: Record<string, unknown>;
  currentIndex?: number;
  completed?: boolean;
}

export const surveyDraftService = {
  async create(meta: CreateMeta): Promise<{ id: string }> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    const rows = await sql<{ id: string }[]>`
      insert into survey_drafts (ip_address, user_agent)
      values (${meta.ipAddress}, ${meta.userAgent})
      returning id
    `;
    return rows[0]!;
  },

  async update(id: string, patch: DraftPatch): Promise<boolean> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');

    const answersJson    = patch.answers    != null ? JSON.stringify(patch.answers)    : null;
    const otherTextsJson = patch.otherTexts != null ? JSON.stringify(patch.otherTexts) : null;
    const currentIndex   = patch.currentIndex ?? null;
    const markComplete   = patch.completed === true;

    const rows = await sql<{ id: string }[]>`
      update survey_drafts set
        answers       = coalesce(${answersJson}::jsonb, answers),
        other_texts   = coalesce(${otherTextsJson}::jsonb, other_texts),
        current_index = coalesce(${currentIndex}::int, current_index),
        completed_at  = case when ${markComplete} then now() else completed_at end,
        updated_at    = now()
      where id::text = ${id}
      returning id
    `;
    return rows.length > 0;
  },
};
