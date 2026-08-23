import posthog from 'posthog-js';

const PENDING_SURVEY_KEY = 'lokalka_pending_completion_survey';
const posthogKey = String(import.meta.env.VITE_POSTHOG_KEY || '').trim();
const posthogHost = String(import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com').trim();

let initialized = false;

export function initAnalytics() {
  if (initialized || !posthogKey) return false;

  posthog.init(posthogKey, {
    api_host: posthogHost,
    autocapture: false,
    capture_pageview: true,
    persistence: 'localStorage'
  });
  initialized = true;
  return true;
}

export function track(event, properties = {}) {
  if (!initialized) return;
  posthog.capture(event, properties);
}

export function markCompletionSurveyPending() {
  localStorage.setItem(PENDING_SURVEY_KEY, String(Date.now()));
}

export function triggerPendingCompletionSurvey() {
  const createdAt = Number(localStorage.getItem(PENDING_SURVEY_KEY) || 0);
  if (!createdAt) return false;

  localStorage.removeItem(PENDING_SURVEY_KEY);
  if (Date.now() - createdAt > 24 * 60 * 60 * 1000) return false;

  track('recount_completed', { has_pdf: true, returned_from_pdf: true });
  return true;
}
