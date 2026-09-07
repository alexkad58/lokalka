# RecountPro

Монорепозиторий с Fastify backend и React frontend.

## Запуск

```bash
npm install
npm install --prefix server
npm install --prefix client
npm run dev
```

## Структура

- `server/` - Fastify API. Bootstrap находится в `server/server.js`, а routes, auth, storage, PDF и services разделены по модулям.
- `server/routes/` - HTTP-маршруты без запуска/конфигурации сервера.
- `server/services/` - бизнес-логика просчетов, audit logs, Shop API и TSD lifecycle.
- `server/auth/` - пароли, сессии и middleware доступа.
- `server/db/` - JSON storage и barcode cache.
- `server/pdf/` - подготовка PDF-таблиц и rendering helpers.
- `server/utils/` - чистые функции дат, чисел, request и logging metadata.
- `client/` - React UI для загрузки файла и работы с объектом пересчёта.
- `tsd/` - Telegram-бот для помощи с ТСД.

Автоматические проверки находятся в `tests/`. Команда `npm test` запускает unit- и HTTP smoke-тесты через Fastify `app.inject()` без открытия порта и запуска TSD-бота.

## TSD бот вместе с backend

Бот из `tsd/` запускается автоматически при старте backend (`npm run dev --prefix server` и `npm run start --prefix server`).

Для запуска бота нужна одна из переменных в `server/.env`:

- `TG_TOKEN` или `TOKEN` - токен Telegram бота.

Опциональные:

- `TSD_BOT_ENABLED=1` - включить/выключить автозапуск бота (`0` выключает; по умолчанию включен).
- `TSD_PROXY=http://login:password@host:port` - единая переменная прокси для бота.

При указании `TSD_PROXY` она автоматически применяется ко всем исходящим запросам бота.

## Основной API

- `GET /health` - проверка доступности сервера.
- `POST /api/recount/parse-pdf` - разобрать PDF без создания активного просчета.
- `POST /api/recounts/from-pdf` - создать активный просчет из PDF.
- `GET /api/recounts` - получить активный и завершенные просчеты.
- `POST /api/recount/resolve-barcode` - найти артикул по штрихкоду.

## Переменные окружения

Основные настройки читаются из `server/.env`:

- `PORT`, `ADMIN_LOGIN`, `ADMIN_PASSWORD`, `SESSION_TTL_DAYS`;
- `SHOP_API_URL`, `SHOP_API_METHOD`, `SHOP_API_TOKEN`;
- `SHOP_API_TOKEN_HEADER`, `SHOP_API_REFRESH_HEADER`, `SHOP_API_TOKEN_PREFIX`;
- `SHOP_API_CITY_ID`, `SHOP_API_SHOP_ID`, `SHOP_API_USER_AGENT`, `SHOP_API_STDOUT_LOGS`;
- `TG_TOKEN` или `TOKEN`, `TSD_BOT_ENABLED`, `TSD_PROXY`;
- `LOKALKA_DATA_FILE`, `LOKALKA_BARCODE_CACHE_FILE` для нестандартных путей storage.

Секреты и runtime-файлы `server/.env`, `storage.json` и `barcode-cache.json` исключены из Git.

## Проверки и smoke

```bash
npm test
npm run build
```

При запущенном backend можно проверить endpoint:

```bash
npm run smoke:health
```

Для другого адреса:

```powershell
$env:LOKALKA_HEALTH_URL="http://127.0.0.1:3000"
npm run smoke:health
```

## Деплой на прод

В корне репозитория есть скрипт `deploy.sh` для сервера.

Пример использования на проде:

```bash
cd /var/www/lokalka
chmod +x deploy.sh
./deploy.sh
```

Скрипт делает:

- `git pull --ff-only origin main`
- установку зависимостей для `server` и `client`
- `npm run build` для фронтенда
- `pm2 restart lokalka-api --update-env`

## Автодеплой через GitHub Actions

В репозиторий добавлен workflow `.github/workflows/deploy.yml`.

После каждого `git push origin main` GitHub Actions подключается к серверу по SSH и запускает `./deploy.sh`.

Перед этим нужно добавить в GitHub репозиторий secrets:

- `DEPLOY_HOST` - IP или домен сервера
- `DEPLOY_PORT` - порт SSH, обычно `22`
- `DEPLOY_USER` - пользователь для SSH, например `root`
- `DEPLOY_PATH` - путь к приложению на сервере, обычно `/var/www/lokalka`
- `DEPLOY_SSH_KEY_BASE64` - приватный SSH-ключ для входа на сервер в base64

Можно использовать и `DEPLOY_SSH_KEY`, но для Windows безопаснее `DEPLOY_SSH_KEY_BASE64`, чтобы GitHub Secrets не ломал переносы строк ключа.

Путь в GitHub:

```text
Repository -> Settings -> Secrets and variables -> Actions
```

Если ключа для автодеплоя еще нет, создайте отдельную пару ключей и добавьте публичный ключ на сервер в `~/.ssh/authorized_keys`.

Команда для подготовки base64-секрета в PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.ssh\lokalka_deploy"))
```

Получившуюся строку целиком сохраните в GitHub Secret `DEPLOY_SSH_KEY_BASE64`.