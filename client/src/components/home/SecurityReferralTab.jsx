function trialLabel(days) {
  return Number(days) === 3 ? '3 дня' : '1 день';
}

export default function SecurityReferralTab({
  referralData,
  loading,
  error,
  status,
  onRefresh,
  onCopyInviteLink
}) {
  const completedRecounts = Math.max(0, Number(
    referralData?.completedRecountsCount ?? referralData?.completedRecountsTotal ?? 0
  ));

  if (loading) {
    return <div className="status">Загрузка статистики по коду СБ...</div>;
  }

  if (error) {
    return (
      <div className="security-referral-state">
        <div className="status error">{error}</div>
        <button type="button" className="ghost" onClick={onRefresh}>Повторить</button>
      </div>
    );
  }

  if (!referralData?.code) {
    return (
      <div className="security-referral-state">
        <div className="status">Код СБ пока не выдан администратором</div>
        <button type="button" className="ghost" onClick={onRefresh}>Обновить</button>
      </div>
    );
  }

  return (
    <div className="security-referral-panel">
      <div className="security-referral-inline-row">
        <div className="security-referral-code-row">
          <span className="line mini">Код СБ:</span>
          <span className="security-referral-code">{referralData.code}</span>
        </div>
        <button type="button" className="ghost" onClick={onCopyInviteLink}>Копировать ссылку</button>
      </div>

      {status?.message ? <div className={`status ${status.tone === 'error' ? 'error' : status.tone === 'success' ? 'success' : ''}`}>{status.message}</div> : null}

      <table className="security-referral-table" aria-label="Статистика реферального кода СБ">
        <thead>
          <tr>
            <th>Пробный срок</th>
            <th>Активации</th>
            <th>Завершённые локалки</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{trialLabel(referralData.trialDays)}</td>
            <td>{Number(referralData.activationsCount || 0)}</td>
            <td>{completedRecounts}</td>
          </tr>
        </tbody>
      </table>

      <div className="admin-card-actions">
        <button type="button" className="ghost" onClick={onRefresh}>Обновить статистику</button>
      </div>
    </div>
  );
}
