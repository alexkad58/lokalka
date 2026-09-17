import { fetch as undiciFetch, ProxyAgent } from 'undici';

const TELEGRAM_API_ROOT = 'https://api.telegram.org';

function normalizeProxyUrl(value) {
  const proxy = String(value || '').trim();
  return proxy.replace(/^socks5h:\/\//i, 'socks5://');
}

function clip(value, maxLength = 120) {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function formatUser(user) {
  if (!user) return '-';
  const login = clip(user.login || user.actorLogin || user.id || '-', 80);
  const id = user.id || user.actorId ? ` (${user.id || user.actorId})` : '';
  return `${login}${id}`;
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
}

function createTelegramFetch(proxy) {
  const normalizedProxy = normalizeProxyUrl(proxy);
  if (!normalizedProxy) return (url, options = {}) => undiciFetch(url, options);
  const proxyAgent = new ProxyAgent(normalizedProxy);
  return (url, options = {}) => undiciFetch(url, { ...options, dispatcher: proxyAgent });
}

export function createTelegramLogService({ config, logEvent }) {
  const token = config.telegramToken || config.fallbackToken;
  const chatId = config.groupId;
  const enabled = Boolean(config.enabled && token && chatId);
  const telegramFetch = createTelegramFetch(config.proxy);

  async function sendMessage(text) {
    if (!enabled) return;
    const response = await telegramFetch(`${TELEGRAM_API_ROOT}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Telegram sendMessage failed: ${response.status} ${clip(body, 240)}`);
    }
  }

  function notify(eventName, text) {
    if (!enabled) return;
    sendMessage(text).catch(error => {
      logEvent('warn', 'telegram-log-send-failed', {
        eventName,
        message: error?.message || String(error)
      });
    });
  }

  function notifyRegistration({ user, ip }) {
    notify('registration', [
      'Регистрация',
      `Пользователь: ${formatUser(user)}`,
      `IP: ${clip(ip || '-', 80)}`,
      `Время: ${formatDateTime(user?.createdAt)}`
    ].join('\n'));
  }

  function notifyReferralActivation({ user, owner, activation, referralCodeMask }) {
    notify('referral-activation', [
      'Активация реферального кода',
      `Кто активировал: ${formatUser(user)}`,
      `Владелец кода: ${formatUser(owner)}`,
      `Код: ${referralCodeMask || '-'}`,
      `Пробный доступ: ${activation?.trialDays || '-'} дн., до ${formatDateTime(activation?.trialUntil)}`,
      `Источник: ${clip(activation?.source || '-', 80)}`
    ].join('\n'));
  }

  function notifyRecountStarted({ user, recount, source }) {
    notify('recount-started', [
      'Начало просчета',
      `Пользователь: ${formatUser(user)}`,
      `Документ: ${clip(recount?.docId || recount?.id || '-', 80)}`,
      `Источник: ${clip(source || recount?.sourceFileName || '-', 120)}`,
      `Магазин: ${clip(recount?.storeLabel || recount?.storeNumber || '-', 120)}`,
      `Позиций: ${Array.isArray(recount?.items) ? recount.items.length : 0}`,
      `Время: ${formatDateTime(recount?.createdAt)}`
    ].join('\n'));
  }

  function notifyRecountCompleted({ user, recount, summary }) {
    notify('recount-completed', [
      'Конец просчета',
      `Пользователь: ${formatUser(user)}`,
      `Документ: ${clip(recount?.docId || recount?.id || '-', 80)}`,
      `Магазин: ${clip(recount?.storeLabel || recount?.storeNumber || '-', 120)}`,
      `Просчитывающий: ${clip(recount?.counterName || '-', 120)}`,
      `Группа: ${clip(recount?.groupName || '-', 120)}`,
      `Заполнено: ${summary?.filledCount ?? 0}/${summary?.totalItems ?? 0}`,
      `Расхождений: ${summary?.mismatchCount ?? 0}`,
      `Сумма: ${summary?.totalSumRub ?? 0} руб.`,
      `Время: ${formatDateTime(recount?.completedAt)}`
    ].join('\n'));
  }

  return {
    enabled,
    notifyRegistration,
    notifyReferralActivation,
    notifyRecountStarted,
    notifyRecountCompleted
  };
}