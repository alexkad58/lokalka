import { formatStartDate, formatSubscriptionStatusLabel, getUserDaysRemaining } from '../../utils/formatting.js';

export default function AdminUsersTab({
  adminUsers,
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
  setExpandedUserId
}) {
  return (
    <section className="panel admin-panel-section">
      <div className="admin-section-header">
        <div>
          <h3>Пользователи системы</h3>
          <p className="line mini">Управление доступом, подписками и привязкой устройств</p>
        </div>
        <button
          type="button"
          className="ghost"
          onClick={refreshAdminUsers}
          disabled={homeLoading}
          title="Обновить список пользователей"
        >
          {homeLoading ? 'Загрузка...' : '🔄 Обновить'}
        </button>
      </div>

      <div className="admin-users-controls">
        <div className="admin-search-wrapper">
          <input
            type="search"
            className="admin-search-input"
            placeholder="🔍 Поиск по логину..."
            value={adminUserSearch}
            onChange={e => setAdminUserSearch(e.target.value)}
          />
          {adminUserSearch ? (
            <button type="button" className="admin-search-clear" onClick={() => setAdminUserSearch('')}>✕</button>
          ) : null}
        </div>

        <div className="admin-filter-chips">
          <button
            type="button"
            className={`admin-filter-chip ${adminUserFilter === 'all' ? 'active' : ''}`}
            onClick={() => setAdminUserFilter('all')}
          >
            Все ({adminUsers.length})
          </button>
          <button
            type="button"
            className={`admin-filter-chip ${adminUserFilter === 'active' ? 'active' : ''}`}
            onClick={() => setAdminUserFilter('active')}
          >
            Активные ({activeUsersCount})
          </button>
          <button
            type="button"
            className={`admin-filter-chip ${adminUserFilter === 'inactive' ? 'active' : ''}`}
            onClick={() => setAdminUserFilter('inactive')}
          >
            Неактивные ({inactiveUsersCount})
          </button>
        </div>

        <div className="admin-activation-quickset">
          <span className="line mini">Быстрая активация:</span>
          <div className="admin-days-presets">
            {['30', '90', '180', '365'].map(d => (
              <button
                key={d}
                type="button"
                className={`admin-day-btn ${activationDays === d ? 'active' : ''}`}
                onClick={() => setActivationDays(d)}
              >
                {d} дн.
              </button>
            ))}
            <input
              type="number"
              min="1"
              max="3650"
              className="admin-days-custom-input"
              value={activationDays}
              onChange={e => setActivationDays(e.target.value)}
              title="Своё количество дней"
            />
          </div>
        </div>
      </div>

      {homeLoading ? <div className="status">Загрузка пользователей...</div> : null}

      {!homeLoading ? (
        <div className="admin-users-list">
          {filteredAdminUsers.map(item => {
            const daysRemaining = getUserDaysRemaining(item);
            const isActivating = activatingUserId === item.id;

            return (
              <article key={item.id} className={`admin-user-card ${item.isAdmin ? 'is-admin' : ''}`}>
                <div className="admin-user-main">
                  <div className="admin-user-title-row">
                    <span className="admin-user-login">{item.login}</span>
                    {item.isAdmin ? (
                      <span className="admin-badge badge-admin">👑 Администратор</span>
                    ) : item.subscriptionActive ? (
                      <span className={`admin-badge ${daysRemaining !== null && daysRemaining <= 3 ? 'badge-warning' : 'badge-success'}`}>
                        🟢 Активен {daysRemaining !== null ? `(${daysRemaining} дн.)` : ''}
                      </span>
                    ) : (
                      <span className="admin-badge badge-danger">🔴 Неактивен</span>
                    )}
                  </div>

                  <div className="admin-user-meta-row">
                    <span className="line mini">
                      {item.isAdmin ? 'Полный доступ' : `Подписка: ${formatSubscriptionStatusLabel(item)}`}
                    </span>
                    <span className="line mini">
                      📱 Устройство:{' '}
                      {item.deviceBindingDisabled ? (
                        <strong className="text-warning">Без привязки</strong>
                      ) : item.deviceBound ? (
                        <strong className="text-success">Привязано</strong>
                      ) : (
                        <span className="text-muted">Не привязано</span>
                      )}
                    </span>
                    <span className="line mini text-muted">
                      Регистрация: {formatStartDate(item.createdAt)}
                    </span>
                  </div>
                </div>

                <div className="admin-user-actions">
                  {!item.isAdmin ? (
                    <button
                      type="button"
                      className="admin-action-btn primary"
                      onClick={() => activateSubscriptionForUser(item.id)}
                      disabled={isActivating}
                      title={`Продлить подписку на ${activationDays} дн.`}
                    >
                      {isActivating ? '...' : `+${activationDays} дн.`}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ghost admin-action-btn"
                    onClick={() => setExpandedUserId(item.id)}
                    title="Детальные настройки аккаунта"
                  >
                    ⚙️ Управление
                  </button>
                </div>
              </article>
            );
          })}

          {!filteredAdminUsers.length ? (
            <div className="status empty-state">
              Пользователи не найдены {adminUserSearch ? `по запросу "${adminUserSearch}"` : ''}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
