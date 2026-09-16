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
  settingsSaving,
  isSecurityUser,
  securityReferralData,
  securityReferralLoading,
  securityReferralError,
  securityReferralStatus,
  refreshSecurityReferralData,
  copySecurityInviteLink,
  inviteNotice,
  codebookData,
  codebookFilter,
  setCodebookFilter,
  codebookPage,
  setCodebookPage,
  codebookLoading,
  codebookLoadingMore,
  codebookProducts,
  codebookFeedRef,
  codebookLoadMoreRef,
  refreshCodebook,
  openProductCard,
  productCard,
  setProductCard,
  codebookSearch,
  setCodebookSearch,
  productCardLoading,
  productCardError,
  productCardSaving,
  productCardDeleting,
  saveProductCard,
  deleteProductCard,
  openCodebook
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
      {inviteNotice ? <section className="status">{inviteNotice}</section> : null}

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
            {isSecurityUser ? (
              <button
                type="button"
                className={`home-subtab ${homeTab === 'codebook' ? 'active' : ''}`}
                onClick={openCodebook}
              >
                Коды товара
              </button>
            ) : null}
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

        {homeTab === 'codebook' && isSecurityUser ? (
          <>
            <div className="home-history-head">
              <div className="home-subtabs" role="tablist" aria-label="Фильтр привязок">
                <button type="button" className={`home-subtab ${codebookFilter === 'all' ? 'active' : ''}`} onClick={() => setCodebookFilter('all')}>Все</button>
                <button type="button" className={`home-subtab ${codebookFilter === 'conflict' ? 'active' : ''}`} onClick={() => setCodebookFilter('conflict')}>Конфликты</button>
              </div>
            </div>

            <div className="settings-field" style={{ marginBottom: '12px' }}>
              <label htmlFor="security-codebook-search">Поиск по коду товара</label>
              <input id="security-codebook-search" value={codebookSearch} onChange={event => setCodebookSearch(event.target.value)} placeholder="Например: 12345" />
            </div>

            {codebookLoading ? <div className="status">Загрузка списка...</div> : null}

            {!codebookLoading ? (
              <div ref={codebookFeedRef} className="history-list codebook-feed">
                {(codebookData.entries || []).filter(entry => !codebookSearch || String(entry.code).includes(String(codebookSearch).trim())).map(entry => (
                  <article key={entry.code} className={`history-item ${entry.conflict ? 'conflict' : ''}`}>
                    <div className="history-item-head">
                      <div className="codebook-item-title">
                        {codebookProducts?.[String(entry.code)]?.imgPreview || codebookProducts?.[String(entry.code)]?.img ? (
                          <img src={codebookProducts[String(entry.code)].imgPreview || codebookProducts[String(entry.code)].img} alt="" className="codebook-item-image" />
                        ) : <span className="codebook-item-image-placeholder" />}
                        <span><strong>{codebookProducts?.[String(entry.code)]?.name || 'Загрузка товара...'}</strong><small>{entry.code}</small></span>
                      </div>
                      {entry.conflict ? <span className="status error" style={{ padding: '4px 8px' }}>конфликт</span> : null}
                    </div>
                    <div className="line mini">ШК: {entry.barcodes.join(', ') || '—'}</div>
                    <div className="line mini">Связей: {entry.barcodeCount}</div>
                    <button type="button" className="ghost" onClick={() => openProductCard(entry.code)}>Открыть карточку</button>
                  </article>
                ))}
              </div>
            ) : null}

            {!codebookLoading && !(codebookData.entries || []).length ? (
              <div className="status">Нет записей по текущему фильтру</div>
            ) : null}

            <div ref={codebookLoadMoreRef} className="codebook-load-more">
              {codebookLoadingMore ? <span>Загружаем следующие товары...</span> : null}
              {!codebookLoadingMore && codebookPage < (codebookData.totalPages || 1) ? <span>Прокрутите ниже для загрузки</span> : null}
              {!codebookLoadingMore && codebookPage >= (codebookData.totalPages || 1) && codebookData.total ? <span>Все товары загружены</span> : null}
            </div>
          </>
        ) : null}

        {productCard && isSecurityUser ? (
          <div className="modal-backdrop" onClick={() => setProductCard(null)}>
            <div className="modal-card product-card-modal" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Карточка товара: {productCard.articleCode}</h3>
              <button type="button" className="ghost mini-close-btn" onClick={() => setProductCard(null)} aria-label="Закрыть">✕</button>
            </div>
            {productCardLoading ? <div className="status">Загрузка карточки...</div> : null}
            {productCardError ? <div className="status error">{productCardError}</div> : null}
            {!productCardLoading && productCard.product ? (
              <div className="product-card-layout">
                <div className="product-card-image-wrap">
                  <img src={productCard.product.imgPreview || productCard.product.img} alt={productCard.product.name || productCard.articleCode} className="product-card-image" />
                </div>
                <div className="product-card-body">
                  <h4>{productCard.product.name || 'Товар без названия'}</h4>
                  {productCard.product.description ? <p>{productCard.product.description}</p> : null}
                  <div className="line mini">Тип: {productCard.product.type || '—'}</div>
                  <div className="line mini">Литраж/грамовка: {productCard.product.measure || '—'}</div>
                  <div className="line mini">Остаток: {productCard.product.quantity ?? '—'}</div>
                  {productCard.editing ? (
                    <label className="settings-field">
                      <span>Связанные ШК</span>
                      <textarea
                        value={productCard.barcodes.join('\n')}
                        onChange={event => setProductCard({
                          ...productCard,
                          barcodes: Array.from(new Set(event.target.value.split(/[\s,;]+/).map(value => value.trim()).filter(Boolean)))
                        })}
                        rows={4}
                      />
                    </label>
                  ) : <div className="line mini">Связанные ШК: {productCard.barcodes.join(', ') || '—'}</div>}
                  <div className="product-card-actions">
                    {productCard.editing ? <button type="button" className="ghost" onClick={saveProductCard} disabled={productCardSaving}>{productCardSaving ? 'Сохранение...' : 'Сохранить'}</button> : null}
                    <button type="button" className="ghost" onClick={() => setProductCard({
                      ...productCard,
                      editing: !productCard.editing,
                      barcodes: productCard.editing ? [...(productCard.originalBarcodes || [])] : productCard.barcodes
                    })} disabled={productCardSaving || productCardDeleting}>{productCard.editing ? 'Отменить' : 'Редактировать'}</button>
                    <button type="button" className="danger" onClick={() => deleteProductCard(productCard.articleCode)} disabled={productCardDeleting}>{productCardDeleting ? 'Удаление...' : 'Удалить'}</button>
                  </div>
                </div>
              </div>
            ) : null}
            </div>
          </div>
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
        isSecurityUser={isSecurityUser}
        securityReferralData={securityReferralData}
        securityReferralLoading={securityReferralLoading}
        securityReferralError={securityReferralError}
        securityReferralStatus={securityReferralStatus}
        refreshSecurityReferralData={refreshSecurityReferralData}
        copySecurityInviteLink={copySecurityInviteLink}
      />
    </div>
  );
}
