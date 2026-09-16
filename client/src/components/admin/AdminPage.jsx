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
  setReferralTrialDays
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
          filteredAdminLogs={filteredAdminLogs}
          copiedLogId={copiedLogId}
          copyLogToClipboard={copyLogToClipboard}
        />
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
