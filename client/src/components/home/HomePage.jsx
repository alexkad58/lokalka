import SettingsModal from './SettingsModal.jsx';
import { formatRub, formatStartDate } from '../../utils/formatting.js';
import { formatPatchNoteDate, PATCHNOTE_PREVIEW_LIMIT } from '../../utils/patchnotes.js';

export default function HomePage({
  fileInputRef,
  handleUpload,
  user,
  openSettings,
  handleLogout,
  error,
  homeLoading,
  activeSummary,
  openRecount,
  loading,
  homeTab,
  setHomeTab,
  previousRecounts,
  reopenPreviousRecount,
  deletePreviousRecount,
  deletingRecountId,
  patchNotesLoading,
  patchNotesError,
  patchNotes,
  refreshPatchNotes,
  sortedPatchNotes,
  expandedPatchNotes,
  togglePatchNoteExpanded,
  openTsd,
  settingsOpen,
  closeSettings,
  defaultCounterNameInput,
  setDefaultCounterNameInput,
  feedbackSoundEnabled,
  setFeedbackSoundEnabled,
  saveAccountSettings,
  settingsSaving
}) {
  return (
    <div className="home-page">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        onChange={handleUpload}
        className="hidden-file"
      />

      <header className="home-header">
        <div>
          <h2>Локалка</h2>
          <p>Пользователь: {user?.login || '-'}</p>
        </div>
        <div className="home-header-actions">
          <button type="button" className="ghost" onClick={openSettings}>Настройки</button>
          <button type="button" onClick={() => handleLogout()} className="ghost">Выйти</button>
        </div>
      </header>

      {error ? <section className="status error">{error}</section> : null}

      <section className="panel">
        <h3>Активный просчет</h3>
        {homeLoading ? <div className="status">Загрузка...</div> : null}

        {!homeLoading && activeSummary ? (
          <div className="compact-card">
            <div>Документ: {activeSummary.docId}</div>
            <div>Позиции: {activeSummary.totalItems}</div>
            <div>Расхождения: {activeSummary.mismatchCount}</div>
            <button type="button" onClick={() => openRecount(activeSummary.id)}>Продолжить</button>
          </div>
        ) : null}

        {!homeLoading && !activeSummary ? (
          <div className="compact-card">
            <div>Для начала нового просчета загрузите PDF-файл</div>
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={loading}>
              {loading ? 'Загрузка...' : 'Загрузить .PDF'}
            </button>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="home-history-head">
          <h3>{homeTab === 'recounts' ? 'Завершенные локалки' : 'Патчноуты проекта'}</h3>
          <div className="home-subtabs" role="tablist" aria-label="Разделы">
            <button
              type="button"
              className={`home-subtab ${homeTab === 'recounts' ? 'active' : ''}`}
              onClick={() => setHomeTab('recounts')}
            >
              Локалки
            </button>
            <button
              type="button"
              className={`home-subtab ${homeTab === 'patchnotes' ? 'active' : ''}`}
              onClick={() => {
                setHomeTab('patchnotes');
                if (!patchNotes.length && !patchNotesLoading) {
                  void refreshPatchNotes();
                }
              }}
            >
              Патчноуты
            </button>
          </div>
        </div>

        {homeTab === 'recounts' ? (
          <>
            {!previousRecounts.length ? <div className="status">История пустая</div> : null}
            <div className="history-list">
              {previousRecounts.map(item => (
                <article key={item.id} className="history-item">
                  <div className="history-item-head">
                    <div>{item.groupName || 'Без названия группы'}</div>
                    <button
                      type="button"
                      className="history-eye-btn"
                      title="Открыть для доработки"
                      aria-label="Открыть для доработки"
                      onClick={() => reopenPreviousRecount(item.id)}
                      disabled={loading}
                    >
                      👁
                    </button>
                  </div>
                  <div className="line mini">Итог: {formatRub(item.totalSumRub)}</div>
                  <div className="line mini">Дата начала: {formatStartDate(item.createdAt)}</div>
                  <div className="line mini">Просчитывающий: {item.counterName || '-'}</div>
                  <button
                    type="button"
                    className="danger history-delete-btn"
                    onClick={() => deletePreviousRecount(item.id)}
                    disabled={deletingRecountId === item.id}
                  >
                    {deletingRecountId === item.id ? 'Удаление...' : 'Удалить просчет'}
                  </button>
                </article>
              ))}
            </div>
          </>
        ) : null}

        {homeTab === 'patchnotes' ? (
          <>
            {patchNotesLoading ? <div className="status">Загрузка патчноутов...</div> : null}
            {patchNotesError ? <div className="status error">{patchNotesError}</div> : null}
            {!patchNotesLoading && !patchNotesError && !sortedPatchNotes.length ? (
              <div className="status">Патчноуты пока не добавлены</div>
            ) : null}
            {!patchNotesLoading && !patchNotesError ? (
              <div className="patchnote-list">
                {sortedPatchNotes.map(note => {
                  const isExpanded = Boolean(expandedPatchNotes[note.id]);
                  const hasLongText = note.text.length > PATCHNOTE_PREVIEW_LIMIT;
                  const previewText = hasLongText && !isExpanded
                    ? `${note.text.slice(0, PATCHNOTE_PREVIEW_LIMIT).trimEnd()}...`
                    : note.text;

                  return (
                    <article key={note.id} className="patchnote-card">
                      <div className="patchnote-date">{formatPatchNoteDate(note.date)}</div>
                      <h4>{note.title}</h4>
                      <p>{previewText}</p>
                      {hasLongText ? (
                        <button
                          type="button"
                          className="ghost patchnote-toggle"
                          onClick={() => togglePatchNoteExpanded(note.id)}
                        >
                          {isExpanded ? 'Свернуть' : 'Читать далее'}
                        </button>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <div className="home-tools-row">
        <button type="button" className="tsd-home-btn" onClick={openTsd}>ТСД</button>
      </div>

      <SettingsModal
        settingsOpen={settingsOpen}
        closeSettings={closeSettings}
        user={user}
        defaultCounterNameInput={defaultCounterNameInput}
        setDefaultCounterNameInput={setDefaultCounterNameInput}
        feedbackSoundEnabled={feedbackSoundEnabled}
        setFeedbackSoundEnabled={setFeedbackSoundEnabled}
        saveAccountSettings={saveAccountSettings}
        settingsSaving={settingsSaving}
      />
    </div>
  );
}
