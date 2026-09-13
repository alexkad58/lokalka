import { formatSubscriptionStatusLabel } from '../../utils/formatting.js';

export default function SettingsModal({
  settingsOpen,
  closeSettings,
  user,
  defaultCounterNameInput,
  setDefaultCounterNameInput,
  feedbackSoundEnabled,
  setFeedbackSoundEnabled,
  saveAccountSettings,
  settingsSaving
}) {
  if (!settingsOpen) return null;

  return (
    <div className="modal-backdrop" onClick={closeSettings}>
      <div className="modal-card" onClick={event => event.stopPropagation()}>
        <h3>Настройки</h3>
        <div className="line mini">Подписка: {formatSubscriptionStatusLabel(user)}</div>
        <label className="settings-field">
          Просчитывающий по умолчанию
          <input
            value={defaultCounterNameInput}
            onChange={event => setDefaultCounterNameInput(event.target.value)}
            placeholder="Имя, которое будет подставляться автоматически"
          />
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={feedbackSoundEnabled}
            onChange={event => setFeedbackSoundEnabled(event.target.checked)}
          />
          Звук сканера и клавиш
        </label>
        <button type="button" onClick={saveAccountSettings} disabled={settingsSaving}>
          {settingsSaving ? 'Сохранение...' : 'Сохранить'}
        </button>
        <button type="button" className="ghost" onClick={closeSettings}>Закрыть</button>
      </div>
    </div>
  );
}
