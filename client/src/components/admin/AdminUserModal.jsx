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
  deletingUserId
}) {
  if (!expandedUserId) return null;
  const targetUser = adminUsers.find(item => item.id === expandedUserId);
  if (!targetUser) return null;
  const daysRemaining = getUserDaysRemaining(targetUser);

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
            <h4>Продление подписки</h4>
            <div className="admin-modal-quick-activate">
              {[30, 90, 180, 365].map(d => (
                <button
                  key={d}
                  type="button"
                  className="ghost"
                  onClick={() => activateSubscriptionForUser(targetUser.id, d)}
                  disabled={activatingUserId === targetUser.id}
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
              disabled={activatingUserId === targetUser.id}
              title="Позволит пользователю авторизоваться с другого устройства"
            >
              {activatingUserId === targetUser.id ? 'Подождите...' : '📱 Сбросить устройство'}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => toggleDeviceBinding(targetUser)}
              disabled={targetUser.isAdmin || activatingUserId === targetUser.id}
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
