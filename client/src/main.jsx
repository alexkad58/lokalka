import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initAnalytics, track, triggerPendingCompletionSurvey } from './analytics';
import './styles.css';

initAnalytics();
track('app_opened');
window.addEventListener('pageshow', triggerPendingCompletionSurvey);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') triggerPendingCompletionSurvey();
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
