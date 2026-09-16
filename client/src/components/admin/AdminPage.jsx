import AdminUsersTab from './AdminUsersTab.jsx';
import AdminLogsTab from './AdminLogsTab.jsx';
import AdminPatchNotesTab from './AdminPatchNotesTab.jsx';
import AdminSettingsTab from './AdminSettingsTab.jsx';
import AdminUserModal from './AdminUserModal.jsx';

export default function AdminPage({
  user,
  handleLogout,
  adminSuccess,
  setAdminSuccess,
  error,
  setError,
  adminTab,
  setAdminTab,
  adminUsers,
  totalLogsCount,
  sortedAdminPatchNotes,
  refreshAdminShopApiSettings,
  refreshAdminContactLinks,
  refreshAdminPatchNotes,
  // Tab 1 props
  adminUserSearch,
  setAdminUserSearch,
  adminUserFilter,
  setAdminUserFilter,
  filteredAdminUsers,
  activeUsersCount,
  inactiveUsersCount,
  activationDays,
  setActivationDays,
  activatingUserId,
  homeLoading,
  refreshAdminUsers,
  activateSubscriptionForUser,
  setExpandedUserId,
  // Tab 2 props
  adminLogLevel,
  refreshAdminLogs,
  adminLogLoading,
  adminLogSearch,
  setAdminLogSearch,
  setAdminLogVisibleLimit,
  adminLogVisibleLimit,
  adminLogCounts,
  adminLogGroupCounts,
  adminLogGroup,
  adminLogUsers,
  adminLogSelectedUsers,
  filteredAdminLogs,
  copiedLogId,
  copyLogToClipboard,
  // Tab 3 props
  adminNewPatchNoteOpen,
  setAdminNewPatchNoteOpen,
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
  updateAdminPatchNoteField,
  savePatchNoteFromAdmin,
  deletePatchNoteFromAdmin,
  // Tab 4 props
  shopApiTokenStatus,
  shopApiTokenInput,
  setShopApiTokenInput,
  saveShopApiToken,
  shopApiTokenSaving,
  adminContactLinks,
  setAdminContactLinks,
  saveContactLinks,
  adminContactLinksSaving,
  // User Modal props
  expandedUserId,
  resetDeviceBindingForUser,
  toggleDeviceBinding,
  deleteUserAccount,
  deletingUserId,
  updateUserSecurityRole,
  issueUserReferralCode,
  copyUserInviteLink,
  referralTrialDays,
  setReferralTrialDays,
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
  codebookConflictOnly,
  openCodebook
}) {
  return (
    <div className="home-page admin-page">
      <header className="home-header">
        <div>
          <h2>Админ-панель</h2>
          <p>Администратор: <strong>{user?.login || '-'}</strong></p>
        </div>
        <button type="button" onClick={() => handleLogout()} className="ghost">Выйти</button>
      </header>

      {adminSuccess ? (
        <section className="status success admin-alert">
          <span>{adminSuccess}</span>
          <button type="button" className="ghost mini-close-btn" onClick={() => setAdminSuccess('')}>✕</button>
        </section>
      ) : null}

      {error ? (
        <section className="status error admin-alert">
          <span>{error}</span>
          <button type="button" className="ghost mini-close-btn" onClick={() => setError('')}>✕</button>
        </section>
      ) : null}

      <div className="admin-tabs">
        <button
          type="button"
          className={`admin-tab ${adminTab === 'users' ? 'active' : ''}`}
          onClick={() => setAdminTab('users')}
        >
          👥 Пользователи <span className="admin-tab-count">{adminUsers.length}</span>
        </button>
        <button
          type="button"
          className={`admin-tab ${adminTab === 'logs' ? 'active' : ''}`}
          onClick={() => setAdminTab('logs')}
        >
          📋 Логи сервера <span className="admin-tab-count">{totalLogsCount}</span>
        </button>
        <button
          type="button"
          className={`admin-tab ${adminTab === 'patchnotes' ? 'active' : ''}`}
          onClick={() => {
            setAdminTab('patchnotes');
            void refreshAdminPatchNotes();
          }}
        >
          📢 Патчноуты <span className="admin-tab-count">{sortedAdminPatchNotes.length}</span>
        </button>
        <button
          type="button"
          className={`admin-tab ${adminTab === 'settings' || adminTab === 'shop-api' ? 'active' : ''}`}
          onClick={() => {
            setAdminTab('settings');
            void refreshAdminShopApiSettings();
            void refreshAdminContactLinks();
          }}
        >
          ⚙️ Настройки
        </button>
        <button
          type="button"
          className={`admin-tab ${adminTab === 'codebook' ? 'active' : ''}`}
          onClick={openCodebook}
        >
          📦 Коды товара
        </button>
      </div>

      {adminTab === 'users' ? (
        <AdminUsersTab
          adminUsers={adminUsers}
          adminUserSearch={adminUserSearch}
          setAdminUserSearch={setAdminUserSearch}
          adminUserFilter={adminUserFilter}
          setAdminUserFilter={setAdminUserFilter}
          filteredAdminUsers={filteredAdminUsers}
          activeUsersCount={activeUsersCount}
          inactiveUsersCount={inactiveUsersCount}
          activationDays={activationDays}
          setActivationDays={setActivationDays}
          activatingUserId={activatingUserId}
          homeLoading={homeLoading}
          refreshAdminUsers={refreshAdminUsers}
          activateSubscriptionForUser={activateSubscriptionForUser}
          setExpandedUserId={setExpandedUserId}
        />
      ) : null}

      {adminTab === 'settings' || adminTab === 'shop-api' ? (
        <AdminSettingsTab
          shopApiTokenStatus={shopApiTokenStatus}
          shopApiTokenInput={shopApiTokenInput}
          setShopApiTokenInput={setShopApiTokenInput}
          saveShopApiToken={saveShopApiToken}
          shopApiTokenSaving={shopApiTokenSaving}
          adminContactLinks={adminContactLinks}
          setAdminContactLinks={setAdminContactLinks}
          saveContactLinks={saveContactLinks}
          adminContactLinksSaving={adminContactLinksSaving}
        />
      ) : null}

      {adminTab === 'patchnotes' ? (
        <AdminPatchNotesTab
          adminNewPatchNoteOpen={adminNewPatchNoteOpen}
          setAdminNewPatchNoteOpen={setAdminNewPatchNoteOpen}
          refreshAdminPatchNotes={refreshAdminPatchNotes}
          adminPatchNotesLoading={adminPatchNotesLoading}
          newPatchNoteDate={newPatchNoteDate}
          setNewPatchNoteDate={setNewPatchNoteDate}
          newPatchNoteTitle={newPatchNoteTitle}
          setNewPatchNoteTitle={setNewPatchNoteTitle}
          newPatchNoteText={newPatchNoteText}
          setNewPatchNoteText={setNewPatchNoteText}
          createPatchNoteFromAdmin={createPatchNoteFromAdmin}
          adminPatchNotesSavingId={adminPatchNotesSavingId}
          adminPatchNotesDeletingId={adminPatchNotesDeletingId}
          sortedAdminPatchNotes={sortedAdminPatchNotes}
          updateAdminPatchNoteField={updateAdminPatchNoteField}
          savePatchNoteFromAdmin={savePatchNoteFromAdmin}
          deletePatchNoteFromAdmin={deletePatchNoteFromAdmin}
        />
      ) : null}

      {adminTab === 'logs' ? (
        <AdminLogsTab
          adminLogLevel={adminLogLevel}
          refreshAdminLogs={refreshAdminLogs}
          adminLogLoading={adminLogLoading}
          adminLogSearch={adminLogSearch}
          setAdminLogSearch={setAdminLogSearch}
          setAdminLogVisibleLimit={setAdminLogVisibleLimit}
          adminLogVisibleLimit={adminLogVisibleLimit}
          totalLogsCount={totalLogsCount}
          adminLogCounts={adminLogCounts}
          adminLogGroupCounts={adminLogGroupCounts}
          adminLogGroup={adminLogGroup}
          adminLogUsers={adminLogUsers}
          adminLogSelectedUsers={adminLogSelectedUsers}
          filteredAdminLogs={filteredAdminLogs}
          copiedLogId={copiedLogId}
          copyLogToClipboard={copyLogToClipboard}
        />
      ) : null}

      {adminTab === 'codebook' ? (
        <section className="panel">
          <div className="home-history-head">
            <h3>Сохранённые коды товаров</h3>
            <div className="home-subtabs" role="tablist" aria-label="Фильтр привязок">
              <button type="button" className={`home-subtab ${codebookFilter === 'all' ? 'active' : ''}`} onClick={() => setCodebookFilter('all')}>Все</button>
              <button type="button" className={`home-subtab ${codebookFilter === 'conflict' ? 'active' : ''}`} onClick={() => setCodebookFilter('conflict')}>Конфликты</button>
            </div>
          </div>

          <div className="settings-field" style={{ marginBottom: '12px' }}>
            <label htmlFor="codebook-search">Поиск по коду товара</label>
            <input id="codebook-search" value={codebookSearch} onChange={event => setCodebookSearch(event.target.value)} placeholder="Например: 12345" />
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
                  <button type="button" className="ghost" onClick={() => openProductCard(entry.code)}>
                    Открыть карточку
                  </button>
                </article>
              ))}
            </div>
          ) : null}

          {!codebookLoading && !(codebookData.entries || []).length ? (
            <div className="status">Нет записей для текущего фильтра</div>
          ) : null}

          <div ref={codebookLoadMoreRef} className="codebook-load-more">
            {codebookLoadingMore ? <span>Загружаем следующие товары...</span> : null}
            {!codebookLoadingMore && codebookPage < (codebookData.totalPages || 1) ? <span>Прокрутите ниже для загрузки</span> : null}
            {!codebookLoadingMore && codebookPage >= (codebookData.totalPages || 1) && codebookData.total ? <span>Все товары загружены</span> : null}
          </div>
        </section>
      ) : null}

      {productCard ? (
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
                  <button type="button" className="danger" onClick={() => deleteProductCard(productCard.articleCode)} disabled={productCardDeleting}>{productCardDeleting ? 'Удаление...' : 'Удалить запись'}</button>
                </div>
              </div>
            </div>
          ) : null}
          </div>
        </div>
      ) : null}

      <AdminUserModal
        expandedUserId={expandedUserId}
        setExpandedUserId={setExpandedUserId}
        adminUsers={adminUsers}
        activateSubscriptionForUser={activateSubscriptionForUser}
        activatingUserId={activatingUserId}
        resetDeviceBindingForUser={resetDeviceBindingForUser}
        toggleDeviceBinding={toggleDeviceBinding}
        deleteUserAccount={deleteUserAccount}
        deletingUserId={deletingUserId}
        updateUserSecurityRole={updateUserSecurityRole}
        issueUserReferralCode={issueUserReferralCode}
        copyUserInviteLink={copyUserInviteLink}
        referralTrialDays={referralTrialDays}
        setReferralTrialDays={setReferralTrialDays}
      />
    </div>
  );
}
