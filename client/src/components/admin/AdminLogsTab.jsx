import { formatLogDateTime, formatLogLevel } from '../../utils/formatting.js';

const ADMIN_LOG_LEVEL_TABS = [
  { key: 'all', label: 'Все' },
  { key: 'error', label: 'Ошибки' },
  { key: 'warn', label: 'Предупр.' },
  { key: 'info', label: 'Инфо' },
  { key: 'debug', label: 'Debug' },
  { key: 'trace', label: 'Trace' }
];

const ADMIN_LOG_GROUP_TABS = [
  { key: 'all', label: 'Все события' },
  { key: 'recount', label: 'Просчёты' },
  { key: 'scanner', label: 'Сканер' },
  { key: 'admin', label: 'Админка' },
  { key: 'auth', label: 'Входы' },
  { key: 'other', label: 'Прочее' }
];

export default function AdminLogsTab({
  adminLogLevel,
  refreshAdminLogs,
  adminLogLoading,
  adminLogSearch,
  setAdminLogSearch,
  setAdminLogVisibleLimit,
  adminLogVisibleLimit,
  totalLogsCount,
  adminLogCounts,
  adminLogGroupCounts,
  adminLogGroup,
  adminLogUsers,
  adminLogSelectedUsers,
  filteredAdminLogs,
  copiedLogId,
  copyLogToClipboard
}) {
  const selectedUserSet = new Set(adminLogSelectedUsers || []);
  const selectedUsersLabel = selectedUserSet.size > 0
    ? `Пользователи: ${selectedUserSet.size}`
    : 'Пользователи: все';

  return (
    <section className="panel admin-panel-section">
      <div className="admin-section-header">
        <div>
          <h3>Журнал событий сервера</h3>
          <p className="line mini">История действий пользователей, авторизаций и ошибок</p>
        </div>
        <button
          type="button"
          className="ghost"
          onClick={() => refreshAdminLogs(adminLogLevel)}
          disabled={adminLogLoading}
        >
          {adminLogLoading ? 'Загрузка...' : '🔄 Обновить логи'}
        </button>
      </div>

      <div className="admin-logs-controls">
        <div className="admin-log-tabs">
          {ADMIN_LOG_LEVEL_TABS.map(tab => {
            const key = tab.key;
            const count = key === 'all'
              ? totalLogsCount
              : Number(adminLogCounts?.[key] || 0);
            const isActive = adminLogLevel === key;

            return (
              <button
                key={key}
                type="button"
                className={`admin-log-tab ${isActive ? 'active' : ''}`}
                onClick={() => refreshAdminLogs(key)}
                disabled={adminLogLoading}
              >
                {tab.label} <span className="admin-tab-count">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="admin-log-tabs admin-log-group-tabs">
          {ADMIN_LOG_GROUP_TABS.map(tab => {
            const key = tab.key;
            const count = key === 'all'
              ? totalLogsCount
              : Number(adminLogGroupCounts?.[key] || 0);
            const isActive = adminLogGroup === key;

            return (
              <button
                key={key}
                type="button"
                className={`admin-log-tab ${isActive ? 'active' : ''}`}
                onClick={() => {
                  setAdminLogVisibleLimit(50);
                  setAdminLogSearch('');
                  refreshAdminLogs(adminLogLevel, key, adminLogSelectedUsers);
                }}
                disabled={adminLogLoading}
              >
                {tab.label} <span className="admin-tab-count">{count}</span>
              </button>
            );
          })}
        </div>

        <details className="admin-log-user-filter">
          <summary>{selectedUsersLabel}</summary>
          <div className="admin-log-user-menu">
            <button
              type="button"
              className="ghost mini-btn"
              onClick={() => {
                setAdminLogVisibleLimit(50);
                setAdminLogSearch('');
                refreshAdminLogs(adminLogLevel, adminLogGroup, []);
              }}
              disabled={adminLogLoading || selectedUserSet.size === 0}
            >
              Сбросить выбор
            </button>
            {(adminLogUsers || []).map(item => {
              const checked = selectedUserSet.has(item.key);
              const nextUsers = checked
                ? (adminLogSelectedUsers || []).filter(key => key !== item.key)
                : [...(adminLogSelectedUsers || []), item.key];

              return (
                <label key={item.key} className="admin-log-user-option">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setAdminLogVisibleLimit(50);
                      setAdminLogSearch('');
                      refreshAdminLogs(adminLogLevel, adminLogGroup, nextUsers);
                    }}
                    disabled={adminLogLoading}
                  />
                  <span>{item.login}</span>
                  <span className="admin-tab-count">{item.count}</span>
                </label>
              );
            })}
          </div>
        </details>

        <div className="admin-search-wrapper">
          <input
            type="search"
            className="admin-search-input"
            placeholder="🔍 Фильтр по событию, логину, IP или тексту..."
            value={adminLogSearch}
            onChange={e => {
              setAdminLogSearch(e.target.value);
              setAdminLogVisibleLimit(50);
            }}
          />
          {adminLogSearch ? (
            <button type="button" className="admin-search-clear" onClick={() => setAdminLogSearch('')}>✕</button>
          ) : null}
        </div>
      </div>

      {adminLogLoading ? <div className="status">Загрузка логов...</div> : null}

      {!adminLogLoading ? (
        <div className="admin-log-list">
          {filteredAdminLogs.slice(0, adminLogVisibleLimit).map(entry => (
            <article key={entry.id} className="admin-log-item">
              <div className="admin-log-item-head">
                <div className="admin-log-head-left">
                  <span className={`admin-log-level ${String(entry.level || 'info').toLowerCase()}`}>
                    {formatLogLevel(entry.level)}
                  </span>
                  <span className="admin-log-event">{entry.event || '-'}</span>
                </div>
                <span className="line mini text-muted">{formatLogDateTime(entry.ts)}</span>
              </div>

              <div className="admin-log-meta-inline">
                <span className="admin-pill">👤 {entry.actorLogin || 'система'}</span>
                {entry.ip ? <span className="admin-pill">🌐 {entry.ip}</span> : null}
                {entry.method ? <span className="admin-pill uppercase">{entry.method}</span> : null}
                {entry.path ? <span className="admin-pill text-truncate">{entry.path}</span> : null}
              </div>

              {entry.meta && Object.keys(entry.meta).length > 0 ? (
                <details className="admin-log-details">
                  <summary>Детали события</summary>
                  <div className="admin-log-meta-container">
                    <button
                      type="button"
                      className="ghost mini-btn copy-log-btn"
                      onClick={() => copyLogToClipboard(entry)}
                    >
                      {copiedLogId === entry.id ? '✓ Скопировано' : '📋 Скопировать JSON'}
                    </button>
                    <pre className="admin-log-meta">{JSON.stringify(entry.meta, null, 2)}</pre>
                  </div>
                </details>
              ) : null}
            </article>
          ))}

          {filteredAdminLogs.length > adminLogVisibleLimit ? (
            <div className="admin-logs-load-more">
              <button
                type="button"
                className="ghost"
                onClick={() => setAdminLogVisibleLimit(prev => prev + 50)}
              >
                Показать ещё (осталось {filteredAdminLogs.length - adminLogVisibleLimit})
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => setAdminLogVisibleLimit(filteredAdminLogs.length)}
              >
                Показать все ({filteredAdminLogs.length})
              </button>
            </div>
          ) : null}

          {!filteredAdminLogs.length ? (
            <div className="status empty-state">
              Логи не найдены {adminLogSearch ? `по фильтру "${adminLogSearch}"` : ''}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
