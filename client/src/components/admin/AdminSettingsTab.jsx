export default function AdminSettingsTab({
  shopApiTokenStatus,
  shopApiTokenInput,
  setShopApiTokenInput,
  saveShopApiToken,
  shopApiTokenSaving,
  adminContactLinks,
  setAdminContactLinks,
  saveContactLinks,
  adminContactLinksSaving
}) {
  return (
    <section className="panel admin-panel-section">
      <div className="admin-section-header">
        <div>
          <h3>Настройки и интеграции</h3>
          <p className="line mini">Конфигурация внешних сервисов и контактов службы поддержки</p>
        </div>
      </div>

      <div className="admin-settings-grid">
        <div className="admin-settings-card">
          <h4>🛒 API магазина (Kaspi / Shop API)</h4>
          <p className="line mini text-muted">
            Используется для автоматического поиска наименований и штрихкодов в базе магазина.
          </p>

          <div className="admin-api-status">
            <div className="line mini">
              Статус токена:{' '}
              {shopApiTokenStatus?.configured ? (
                <strong className="text-success">
                  Подключен (последние символы: ••••{shopApiTokenStatus.tokenLast5 || '—'})
                </strong>
              ) : (
                <strong className="text-warning">Не установлен</strong>
              )}
            </div>
          </div>

          <label className="settings-field">
            Новый токен API
            <input
              type="password"
              value={shopApiTokenInput}
              onChange={event => setShopApiTokenInput(event.target.value)}
              placeholder="Вставьте токен API магазина..."
              autoComplete="new-password"
            />
          </label>
          <div className="admin-card-actions">
            <button
              type="button"
              onClick={saveShopApiToken}
              disabled={shopApiTokenSaving || !shopApiTokenInput.trim()}
            >
              {shopApiTokenSaving ? 'Сохранение...' : 'Сохранить токен'}
            </button>
          </div>
        </div>

        <div className="admin-settings-card">
          <h4>💬 Контакты для активации</h4>
          <p className="line mini text-muted">
            Ссылки отображаются пользователям с истекшей подпиской для связи с администратором.
          </p>

          <div className="admin-contact-links-grid">
            <label className="settings-field">
              Telegram URL
              <input
                type="url"
                value={adminContactLinks.telegramUrl}
                onChange={event => setAdminContactLinks(prev => ({ ...prev, telegramUrl: event.target.value }))}
                placeholder="https://t.me/username"
              />
            </label>
            <label className="settings-field">
              Max URL
              <input
                type="url"
                value={adminContactLinks.maxUrl}
                onChange={event => setAdminContactLinks(prev => ({ ...prev, maxUrl: event.target.value }))}
                placeholder="https://max.ru/..."
              />
            </label>
          </div>

          <div className="admin-card-actions">
            <button
              type="button"
              onClick={saveContactLinks}
              disabled={adminContactLinksSaving}
            >
              {adminContactLinksSaving ? 'Сохранение...' : 'Сохранить ссылки'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
