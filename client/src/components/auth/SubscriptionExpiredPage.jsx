import { formatSubscriptionStatusLabel } from '../../utils/formatting.js';

export default function SubscriptionExpiredPage({
  user,
  handleLogout,
  referralCode,
  setReferralCode,
  referralActivating,
  activateReferral,
  referralStatus,
  pendingInviteCode,
  clearPendingInvite
}) {
  const supportLinks = user?.supportLinks || {
    telegramUrl: 'https://t.me/alekseikb58',
    maxUrl: 'https://www.max.ru/'
  };

  return (
    <div className="auth-page">
      <section className="auth-card">
        <h1>Доступ к сервису</h1>
        <p>Доступ к сервису стоит 1000 руб. в месяц, для активации свяжитесь со мной.</p>

        <div className="subscription-contact-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => window.open(supportLinks.telegramUrl, '_blank', 'noopener,noreferrer')}
            disabled={!supportLinks.telegramUrl}
          >
            Написать в TG
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => window.open(supportLinks.maxUrl, '_blank', 'noopener,noreferrer')}
            disabled={!supportLinks.maxUrl}
          >
            Написать в MAX
          </button>
        </div>

        <div className="subscription-referral-box">
          <div className="line">Есть код приглашения?</div>
          <div className="subscription-referral-actions">
            <input
              type="text"
              value={referralCode}
              onChange={event => setReferralCode(event.target.value)}
              placeholder="Введите код"
              autoComplete="off"
              maxLength={20}
            />
            <button
              type="button"
              onClick={activateReferral}
              disabled={referralActivating}
            >
              {referralActivating ? 'Активация...' : 'Активировать'}
            </button>
          </div>
          {pendingInviteCode ? (
            <div className="line mini">
              В ожидании код из ссылки: {pendingInviteCode}{' '}
              <button type="button" className="ghost" onClick={clearPendingInvite}>Очистить</button>
            </div>
          ) : null}
          {referralStatus?.message ? (
            <div className={`status ${referralStatus.tone === 'error' ? 'error' : referralStatus.tone === 'success' ? 'success' : ''}`}>
              {referralStatus.message}
            </div>
          ) : null}
        </div>

        <div className="status">Статус: {formatSubscriptionStatusLabel(user)}</div>
        <button type="button" className="ghost" onClick={() => handleLogout()}>
          Выйти
        </button>
      </section>
    </div>
  );
}
