export function toIsoNow() {
  return new Date().toISOString();
}

export function formatRuDate(dateValue) {
  const date = dateValue ? new Date(dateValue) : new Date();
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

export function formatRuTime(dateValue) {
  const date = dateValue ? new Date(dateValue) : new Date();
  return date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}
