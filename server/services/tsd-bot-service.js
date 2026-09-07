import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

export function createTsdBotService({ config, logEvent, stdout = console }) {
  let processHandle = null;

  function start() {
    if (!config.enabled) {
      logEvent('info', 'tsd-bot-disabled');
      return;
    }

    if (!config.telegramToken && !config.fallbackToken) {
      logEvent('warn', 'tsd-bot-missing-token', {
        hasTgToken: Boolean(config.telegramToken),
        hasToken: Boolean(config.fallbackToken)
      });
      return;
    }

    if (!existsSync(config.entryFile)) {
      logEvent('warn', 'tsd-bot-missing-entry', { entry: config.entryFile });
      return;
    }

    const environment = { ...config.environment };
    if (config.proxy) {
      environment.TSD_PROXY = config.proxy;
      environment.HTTP_PROXY = config.proxy;
      environment.HTTPS_PROXY = config.proxy;
      environment.ALL_PROXY = config.proxy;
      environment.NODE_USE_ENV_PROXY = '1';
    }

    processHandle = spawn(process.execPath, [config.entryFile], {
      cwd: config.workingDirectory,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    processHandle.stdout.on('data', chunk => {
      const text = String(chunk || '').trim();
      if (text) stdout.log(`[TSD_BOT] ${text}`);
    });
    processHandle.stderr.on('data', chunk => {
      const text = String(chunk || '').trim();
      if (text) stdout.error(`[TSD_BOT_ERR] ${text}`);
    });
    processHandle.on('exit', (code, signal) => {
      logEvent('warn', 'tsd-bot-exit', { code, signal });
      processHandle = null;
    });

    logEvent('info', 'tsd-bot-started', {
      pid: processHandle.pid,
      proxyEnabled: Boolean(config.proxy)
    });
  }

  function stop() {
    if (!processHandle || processHandle.killed) return;
    try {
      processHandle.kill('SIGTERM');
    } catch {
      // Ignore process-kill race conditions during shutdown.
    }
  }

  return { start, stop };
}
