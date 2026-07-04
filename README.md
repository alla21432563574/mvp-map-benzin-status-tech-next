# Есть топливо — MVP карты АЗС

Минималистичная интерактивная карта АЗС со статусами АИ-92, АИ-95, дизеля и газа. Проект готов для Next.js/Vercel и Supabase.

## Возможности

- карта OpenStreetMap на React Leaflet;
- цветные маркеры и фильтры по нескольким видам топлива;
- карточка АЗС с адресом, брендом, временем и источником обновления;
- форма пользовательского сообщения — данные попадают только в `pending_reports`;
- защищённая простым серверным ключом страница `/admin` для принятия и отклонения сообщений;
- атомарное применение принятого сообщения через PostgreSQL-функцию;
- демо-режим с тестовыми АЗС, если Supabase ещё не подключён.
- Telegram-бот для сбора отчётов по сценарию город → АЗС/геолокация → топливо.

## Локальный запуск

Понадобится Node.js 20.9 или новее.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000). Без заполненного `.env.local` карта работает с демонстрационными данными; отправка статуса имитируется и ничего не сохраняет.

## Подключение Supabase

1. Создайте проект в Supabase.
2. Откройте SQL Editor и выполните файл [`supabase/schema.sql`](supabase/schema.sql). Он создаст таблицы, индексы, RLS-политики, функцию модерации и тестовые АЗС.
3. В Project Settings → API скопируйте URL, anon key и service role key.
4. Создайте `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ADMIN_SECRET=длинный-случайный-пароль
```

`SUPABASE_SERVICE_ROLE_KEY` и `ADMIN_SECRET` используются только серверными маршрутами и не попадают в браузер. Не добавляйте `.env.local` в Git.

## Модерация

Перейдите на `/admin` и введите значение `ADMIN_SECRET`. Кнопка «Принять» обновляет статусы топлива станции и помечает сообщение принятым. «Отклонить» меняет только статус сообщения.

## Telegram-бот

Код бота находится в папке `bot`. Инструкция по получению токена, настройке Supabase и запуску приведена в [`bot/README.md`](bot/README.md). Отчёты бота имеют источник `Telegram`, попадают в общую очередь `pending_reports` и подтверждаются через ту же страницу `/admin`.

## Развёртывание на Vercel

1. Импортируйте репозиторий в Vercel.
2. Добавьте переменные `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_SECRET` и `CRON_SECRET` в Project Settings → Environment Variables.
3. Добавьте scraper-переменные из `.env.example`. `SUPABASE_DB_URL` в Vercel Function не нужен.
4. Примените `supabase/migrations/20260704_add_cron_scraper.sql`.
5. Запустите Deploy. `vercel.json` не содержит cron-задач, поэтому деплой совместим с Hobby-тарифом Vercel.

`CRON_SECRET` должен быть отдельным длинным случайным значением. Одно и то же значение нужно добавить в Vercel и GitHub Actions.

## Структура данных

- `stations` — основная проверенная информация об АЗС;
- `pending_reports` — пользовательские предложения и история модерации;
- `moderate_report(...)` — транзакционно применяет принятое сообщение.

Перед публичным запуском рекомендуется заменить общий `ADMIN_SECRET` полноценной авторизацией Supabase Auth и добавить rate limiting/CAPTCHA на отправку сообщений.

## Импорт публичных данных map.benzin-status.tech

Скрипт `scripts/scrape-benzin-status.ts` не запускает браузер. Он делает один прямой HTTP-запрос к публичному REST endpoint `/api/stations`, который использует сама карта. Cookies, токены и авторизация не нужны. CAPTCHA, Cloudflare и rate limits не обходятся; при HTTP 403/429 запуск останавливается.

Перед первым запуском примените `supabase/migrations/20260703_add_benzin_scraper.sql` в Supabase SQL Editor. Миграция добавляет импортные поля станции, таблицу `scrape_logs` и серверную функцию безопасного обновления. Более свежие ручные статусы не перезаписываются.

Добавьте в `.env.local`:

```env
SCRAPER_ENABLED=true
SCRAPER_INTERVAL_SECONDS=180
SCRAPER_CITY=Москва
SCRAPER_CITY_CENTER_LAT=55.7558
SCRAPER_CITY_CENTER_LNG=37.6173
SCRAPER_MAX_STATIONS_PER_RUN=5000
SCRAPER_BOUNDS=55.40,36.80,56.10,38.40
```

Для записи нужны `SUPABASE_SERVICE_ROLE_KEY` и URL проекта: `SUPABASE_URL` или уже используемый Next.js `NEXT_PUBLIC_SUPABASE_URL`. Service role ключ не передаётся чужому сайту и используется только после закрытия страницы для записи результата в вашу Supabase. Если переменные отсутствуют или содержат шаблонные значения, scraper продолжит автономную работу и выведет предупреждение без попытки подключения к Supabase.

Обычный режим запускает импорт сразу, затем повторяет его не чаще указанного интервала (минимум 60 секунд):

```bash
npm run scrape:benzin
```

Для одного наглядного запуска:

```bash
npm run scrape:benzin:debug
```

`SCRAPER_BOUNDS` задаёт область как `latMin,lngMin,latMax,lngMax`. Московская область по умолчанию сейчас возвращает 1535 АЗС одним запросом. Debug-режим сохраняет нормализованный JSON в `outputs/scraper-debug/results.json`. Lock-файл не позволяет двум процессам работать одновременно. Playwright используется только отдельной диагностической командой `pnpm scrape:benzin:audit`.

Полностью автономная проверка без создания Supabase-клиента и любых запросов к базе:

```bash
pnpm scrape:benzin:debug -- --dry-run
```

В dry-run все записи печатаются в консоль и сохраняются в `outputs/scraper-debug/results.json`. Этот режим работает даже при `SCRAPER_ENABLED=false`.

Результат проверяется в таблицах `stations` и `scrape_logs`. Для импортированных станций `external_source` равен `benzin-status`, а `imported_at` показывает время последнего просмотра карты. Остановить модуль полностью можно значением `SCRAPER_ENABLED=false`.

## GitHub Actions: автообновление

Workflow `.github/workflows/scrape.yml` вызывает production endpoint каждые 5 минут. Endpoint `GET /api/cron/scrape` защищён `CRON_SECRET`, использует общий с CLI-scraper модуль и делает массовый upsert одной транзакцией. Каждый запус попадает в `scrape_logs`.

После первого production-деплоя:

1. Скопируйте production URL из Vercel Project → Deployments или Settings → Domains, например `https://fuel-map.vercel.app`.
2. Откройте GitHub Repository → Settings → Secrets and variables → Actions.
3. Добавьте repository secret `CRON_SECRET` — точно тот же секрет, что задан в Vercel.
4. Добавьте repository secret `VERCEL_PROJECT_URL` — production URL с `https://` или без него.
5. Во вкладке GitHub Actions откройте workflow **Update fuel stations** и нажмите **Run workflow** для ручной проверки.

Workflow завершается с ошибкой при любом HTTP-статусе, отличном от 200. GitHub-level `concurrency` не запускает два workflow одновременно, а Supabase-lock в endpoint остаётся вторым уровнем защиты.

Перед стартом endpoint атомарно захватывает распределённую блокировку в Supabase. Если предыдущий запус ещё идёт, новый не начинается и получает:

```text
HTTP 409
{"error":"Scraper already running"}
```

Блокировка имеет lease-срок `SCRAPER_LOCK_SECONDS=600`, поэтому аварийно завершённая serverless-функция не блокирует импорт навсегда.

Перед каждым cron-запуском функция `cleanup_scrape_logs` удаляет записи старше `SCRAPE_LOG_RETENTION_DAYS=30`. Допустимый срок хранения — от 1 до 365 дней; число удалённых строк возвращается в `deletedLogs`.

Ручная проверка:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<project>.vercel.app/api/cron/scrape
```
