export function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeDeviceId(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._:-]/g, '')
    .slice(0, 120);
}

export function getDeviceIdFromRequest(request) {
  return normalizeDeviceId(request?.headers?.['x-device-id']);
}

export function getRequestIp(request) {
  const forwarded = String(request?.headers?.['x-forwarded-for'] || '').trim();
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request?.ip || null;
}
