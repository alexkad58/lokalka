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