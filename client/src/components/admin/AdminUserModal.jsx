import { formatStartDate, formatSubscriptionStatusLabel, getUserDaysRemaining } from '../../utils/formatting.js';

export default function AdminUserModal({
  expandedUserId,
  setExpandedUserId,
  adminUsers,
  activateSubscriptionForUser,
  activatingUserId,
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
  if (!expandedUserId) return null;
  const targetUser = adminUsers.find(item => item.id === expandedUserId);
  if (!targetUser) return null;
  const daysRemaining = getUserDaysRemaining(targetUser);
  const isBusy = activatingUserId === targetUser.id;
  const securityRoleEnabled = Boolean(targetUser?.securityRole || targetUser?.role === 'security' || targetUser?.role === 'sb' || targetUser?.isSecurity || targetUser?.isSb);
  const referralCode = String(targetUser?.referralCode || targetUser?.securityReferralCode || targetUser?.referral?.code || '').trim();
  const referralTrial = Number(targetUser?.referralTrialDays || targetUser?.referral?.trialDays || referralTrialDays || 1);

  return (
    <div className="modal-backdrop" onClick={() => setExpandedUserId('')}>
      <div className="modal-card admin-user-modal" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <h3>Управление аккаунтом: {targetUser.login}</h3>
          <button type="button" className="ghost mini-close-btn" onClick={() => setExpandedUserId('')}>✕</button>
        </div>

        <div className="admin-user-modal-info">
          <div className="admin-info-item">
            <span className="admin-info-label">Статус подписки:</span>
            <span className="admin-info-value">
              {targetUser.isAdmin ? (
                <span className="admin-badge badge-admin">👑 Администратор</span>
              ) : targetUser.subscriptionActive ? (
                <span className="admin-badge badge-success">
                  🟢 {formatSubscriptionStatusLabel(targetUser)} ({daysRemaining} дн.)
                </span>
              ) : (
                <span className="admin-badge badge-danger">🔴 Неактивен</span>
              )}
            </span>
          </div>

          <div className="admin-info-item">
            <span className="admin-info-label">Привязка устройства:</span>
            <span className="admin-info-value">
              {targetUser.deviceBindingDisabled ? (
                <strong className="text-warning">Проверка отключена</strong>
              ) : targetUser.deviceBound ? (
                <strong className="text-success">Устройство привязано</strong>
              ) : (
                <span className="text-muted">Не привязано</span>
              )}
            </span>
          </div>

          <div className="admin-info-item">
            <span className="admin-info-label">Дата регистрации:</span>
            <span className="admin-info-value">{formatStartDate(targetUser.createdAt)}</span>
          </div>
        </div>

        {!targetUser.isAdmin ? (
          <div className="admin-modal-section">
            <h4>Роль СБ и реферальный код</h4>
            <div className="admin-account-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => updateUserSecurityRole(targetUser.id, !securityRoleEnabled)}
                disabled={isBusy}
              >
                {securityRoleEnabled ? 'Снять роль СБ' : 'Назначить роль СБ'}
              </button>
            </div>
            {securityRoleEnabled ? (
              <>
                <div className="admin-referral-days-row">
                  <span className="line mini">Срок триала по коду:</span>
                  <div className="admin-days-presets">
                    {[1, 3].map(day => (
                      <button
                        key={day}
                        type="button"
                        className={`admin-day-btn ${Number(referralTrialDays) === day ? 'active' : ''}`}
                        onClick={() => setReferralTrialDays(day)}
                        disabled={isBusy}
                      >
                        {day} дн.
                      </button>
                    ))}
                  </div>
                </div>
                {referralCode ? (
                  <div className="admin-referral-code-block">
                    <div className="line mini">Текущий код: <strong>{referralCode}</strong></div>
                    <div className="line mini">Текущий срок: {referralTrial} дн.</div>
                  </div>
                ) : (
                  <div className="line mini text-muted">Код еще не создан</div>
                )}
                <div className="admin-account-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => issueUserReferralCode(targetUser.id, false)}
                    disabled={isBusy}
                  >
                    Создать код
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => issueUserReferralCode(targetUser.id, true)}
                    disabled={isBusy}
                  >
                    Перегенерировать
                  </button>
                </div>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => copyUserInviteLink(targetUser)}
                  disabled={!referralCode}
                >
                  Копировать инвайт-ссылку
                </button>
                <div className="line mini text-warning">
                  Внимание: перегенерация сразу отключает старый код и старые ссылки.
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {!targetUser.isAdmin ? (
          <div className="admin-modal-section">
            <h4>Продление подписки</h4>
            <div className="admin-modal-quick-activate">
              {[30, 90, 180, 365].map(d => (
                <button
                  key={d}
                  type="button"
                  className="ghost"
                  onClick={() => activateSubscriptionForUser(targetUser.id, d)}
                  disabled={isBusy}
                >
                  +{d} дн.
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="admin-modal-section">
          <h4>Ограничения и безопасность</h4>
          <div className="admin-account-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => resetDeviceBindingForUser(targetUser.id)}
              disabled={isBusy}
              title="Позволит пользователю авторизоваться с другого устройства"
            >
              {isBusy ? 'Подождите...' : '📱 Сбросить устройство'}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => toggleDeviceBinding(targetUser)}
              disabled={targetUser.isAdmin || isBusy}
            >
              {targetUser.deviceBindingDisabled ? '🔒 Включить привязку' : '🔓 Отключить привязку'}
            </button>
          </div>
        </div>

        {!targetUser.isAdmin ? (
          <div className="admin-modal-section danger-section">
            <h4>Опасная зона</h4>
            <button
              type="button"
              className="danger"
              onClick={() => deleteUserAccount(targetUser.id)}
              disabled={deletingUserId === targetUser.id}
            >
              {deletingUserId === targetUser.id ? 'Удаление...' : '🗑️ Удалить аккаунт'}
            </button>
          </div>
        ) : null}

        <div className="modal-footer">
          <button type="button" className="ghost" onClick={() => setExpandedUserId('')}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
