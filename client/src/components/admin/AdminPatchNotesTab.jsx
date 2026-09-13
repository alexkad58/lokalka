export default function AdminPatchNotesTab({
  adminNewPatchNoteOpen,
  setAdminNewPatchNoteOpen,
  refreshAdminPatchNotes,
  adminPatchNotesLoading,
  newPatchNoteDate,
  setNewPatchNoteDate,
  newPatchNoteTitle,
  setNewPatchNoteTitle,
  newPatchNoteText,
  setNewPatchNoteText,
  createPatchNoteFromAdmin,
  adminPatchNotesSavingId,
  adminPatchNotesDeletingId,
  sortedAdminPatchNotes,
  updateAdminPatchNoteField,
  savePatchNoteFromAdmin,
  deletePatchNoteFromAdmin
}) {
  return (
    <section className="panel admin-panel-section">
      <div className="admin-section-header">
        <div>
          <h3>Управление патчноутами</h3>
          <p className="line mini">Создание и редактирование новостей об обновлениях</p>
        </div>
        <div className="admin-header-actions">
          <button
            type="button"
            className={adminNewPatchNoteOpen ? 'ghost' : 'primary'}
            onClick={() => setAdminNewPatchNoteOpen(prev => !prev)}
          >
            {adminNewPatchNoteOpen ? '✕ Скрыть форму' : '+ Новый патчноут'}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => refreshAdminPatchNotes()}
            disabled={adminPatchNotesLoading}
          >
            {adminPatchNotesLoading ? 'Загрузка...' : '🔄 Обновить'}
          </button>
        </div>
      </div>

      {adminNewPatchNoteOpen ? (
        <div className="patchnote-editor-card new-patchnote-card">
          <h4>Создание нового патчноута</h4>
          <div className="admin-form-row">
            <label className="settings-field">
              Дата публикации
              <input
                type="date"
                value={newPatchNoteDate}
                onChange={event => setNewPatchNoteDate(event.target.value)}
              />
            </label>
            <label className="settings-field flex-2">
              Заголовок
              <input
                value={newPatchNoteTitle}
                onChange={event => setNewPatchNoteTitle(event.target.value)}
                placeholder="Краткий заголовок (например: Обновление интерфейса сканера)"
              />
            </label>
          </div>
          <label className="settings-field">
            Текст патчноута
            <textarea
              value={newPatchNoteText}
              onChange={event => setNewPatchNoteText(event.target.value)}
              placeholder="Подробный список изменений и новшеств..."
              rows={5}
            />
          </label>
          <div className="admin-patchnote-create-actions">
            <button
              type="button"
              onClick={createPatchNoteFromAdmin}
              disabled={adminPatchNotesSavingId === 'new'}
            >
              {adminPatchNotesSavingId === 'new' ? 'Сохранение...' : 'Опубликовать патчноут'}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => setAdminNewPatchNoteOpen(false)}
            >
              Отмена
            </button>
          </div>
        </div>
      ) : null}

      {adminPatchNotesLoading ? <div className="status">Загрузка патчноутов...</div> : null}

      {!adminPatchNotesLoading ? (
        <div className="admin-patchnote-list">
          {sortedAdminPatchNotes.map(item => (
            <article key={item.id} className="patchnote-editor-card">
              <div className="admin-form-row">
                <label className="settings-field">
                  Дата
                  <input
                    type="date"
                    value={item.date}
                    onChange={event => updateAdminPatchNoteField(item.id, 'date', event.target.value)}
                  />
                </label>
                <label className="settings-field flex-2">
                  Заголовок
                  <input
                    value={item.title}
                    onChange={event => updateAdminPatchNoteField(item.id, 'title', event.target.value)}
                  />
                </label>
              </div>
              <label className="settings-field">
                Текст
                <textarea
                  value={item.text}
                  onChange={event => updateAdminPatchNoteField(item.id, 'text', event.target.value)}
                  rows={4}
                />
              </label>
              <div className="patchnote-editor-actions">
                <button
                  type="button"
                  onClick={() => void savePatchNoteFromAdmin(item)}
                  disabled={adminPatchNotesSavingId === item.id || adminPatchNotesDeletingId === item.id}
                >
                  {adminPatchNotesSavingId === item.id ? 'Сохранение...' : '💾 Сохранить'}
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => void deletePatchNoteFromAdmin(item.id)}
                  disabled={adminPatchNotesDeletingId === item.id || adminPatchNotesSavingId === item.id}
                >
                  {adminPatchNotesDeletingId === item.id ? 'Удаление...' : '🗑️ Удалить'}
                </button>
              </div>
            </article>
          ))}
          {!sortedAdminPatchNotes.length ? <div className="status empty-state">Патчноуты пока отсутствуют</div> : null}
        </div>
      ) : null}
    </section>
  );
}
