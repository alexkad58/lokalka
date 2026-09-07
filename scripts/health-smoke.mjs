const baseUrl = String(process.env.LOKALKA_HEALTH_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const response = await fetch(`${baseUrl}/health`);
const body = await response.json().catch(() => null);

if (!response.ok || body?.ok !== true) {
  console.error(`Health check failed: HTTP ${response.status}`);
  console.error(body);
  process.exit(1);
}

console.log(`Health check passed: ${baseUrl}/health`);
