import { Navigate, Route, Routes } from 'react-router-dom';
import { SurveyView } from '@/views/SurveyView';

// Single-route app. `/` and `/survey` both render the questionnaire so the
// standalone host can serve either URL shape. Anything else 404s into the
// survey itself - simpler than maintaining a NotFound page for a one-page
// public study.
export function App() {
  return (
    <Routes>
      <Route path="/" element={<SurveyView />} />
      <Route path="/survey" element={<SurveyView />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
