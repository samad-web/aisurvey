import { Navigate, Route, Routes } from 'react-router-dom';
import { SurveyView } from '@/views/SurveyView';
import { DashboardView } from '@/views/DashboardView';

// `/` and `/survey` render the questionnaire; `/dashboard` is the operator
// view, gated by a passcode entry screen that talks to /api/dashboard/stats
// (which validates against env DASHBOARD_KEY). Anything else falls back to
// the survey itself - simpler than maintaining a NotFound page.
export function App() {
  return (
    <Routes>
      <Route path="/" element={<SurveyView />} />
      <Route path="/survey" element={<SurveyView />} />
      <Route path="/dashboard" element={<DashboardView />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
