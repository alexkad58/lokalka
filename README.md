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

- `server/` - Fastify API для загрузки и парсинга PDF.
- `client/` - React UI для загрузки файла и работы с объектом пересчёта.

## Основной API

- `GET /health` - проверка доступности сервера.
- `POST /api/recount/parse-pdf` - загрузка PDF и возврат объекта пересчёта.

## Что ещё может пригодиться

- `GET /api/recount/:docId` - получить сохранённый объект пересчёта по id.
- `POST /api/recount/:docId/values` - сохранить значения факта/счётчика.
- `POST /api/recount/export` - собрать итоговый JSON или PDF на сервере.
- `GET /api/recount/templates` - если позже появятся разные шаблоны PDF.

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