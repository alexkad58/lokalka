export function formatSubscriptionStatusLabel(account) {
  if (account?.isAdmin) return 'Администратор';
  if (!account?.subscriptionActive || !account?.subscriptionUntil) return 'Неактивный';
  const until = new Date(account.subscriptionUntil);
  if (Number.isNaN(until.getTime())) return 'Неактивный';
  return `Активный до ${until.toLocaleDateString('ru-RU')}`;
}

export function getUserDaysRemaining(account) {
  if (account?.isAdmin) return null;
  if (!account?.subscriptionActive || !account?.subscriptionUntil) return null;
  const until = new Date(account.subscriptionUntil).getTime();
  if (Number.isNaN(until)) return null;
  const now = Date.now();
  return Math.ceil((until - now) / (1000 * 60 * 60 * 24));
}

export function formatRub(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '0.00 руб.';
  return `${amount.toFixed(2)} руб.`;
}

export function formatStartDate(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('ru-RU');
}

export function formatLogDateTime(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ru-RU');
}

export function formatLogLevel(level) {
  const normalized = String(level || '').toLowerCase();
  if (normalized === 'error') return 'ERROR';
  if (normalized === 'warn') return 'WARN';
  if (normalized === 'debug') return 'DEBUG';
  if (normalized === 'trace') return 'TRACE';
  if (normalized === 'fatal') return 'FATAL';
  return 'INFO';
}

export function safeNumber(value) {
  const parsed = Number.parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}
