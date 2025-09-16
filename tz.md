Техническое задание 
0. Общая архитектура
Язык: TypeScript/Node.js.
Используемые библиотеки: – @solana/web3.js (работа с Solana RPC), – p-queue или аналог (управление очередями), – dotenv (чтение настроек из .env), – cross-fetch (запросы к Jupiter API, метаданным и картинкам).
Логирование: простой модуль logger.ts (уровни INFO/ERROR/DEBUG, timestamp, категории).
Все настройки — через .env, никакого хардкода.
Код должен быть разделён на модули: – listeners/ (источники новых пулов), – decoders/ (декодеры транзакций в структуру {poolId, baseMint, quoteMint, lpMint}), – filters/ (каждый фильтр отдельным файлом), – services/ (метаданные, блоктайм, холдеры, LP lock-check), – traders/ (модуль для работы с Jupiter), – bot.ts (основная логика).
1. Источники (Listeners)
Что слушаем
Raydium AMM — через connection.onLogs, режим commitment=processed.
Meteora — через connection.onLogs, аналогично.
PumpSwap — через connection.onLogs.
Требования
Каждый слушатель должен: – Поддерживать backfill последних N слотов (чтобы при старте бот не пропускал пулы). – Уметь дедуплицировать события (TTL, например, 2–3 мин). – Уметь дебаунсить повторные логи. – Работать в режиме «высокой пропускной способности» (без задержек).
При старте логировать: LISTENER_READY dex=... mode=logs.
При детекте пула логировать: DETECTED_POOL dex=... base=... quote=... pool=....
2. Декодеры (Decoders)
Для каждого источника (raydium-amm.decoder.ts, meteora.decoder.ts, pumpswap.decoder.ts) реализовать функцию:
function decodePoolFromTx(tx: ParsedTransactionWithMeta): DetectedPool[]
На выходе: массив { dex, poolId, baseMint, quoteMint, lpMint? }.
Фильтруем только пулы с quote = WSOL (So11111111111111111111111111111111111111112).
Удалять дубликаты.
3. Очередь обработки
Пулы складываются в очередь.
Количество одновременных обработок регулируется параметром .env:
MAX_TOKENS_AT_THE_TIME=3
Если стоит 1 → бот работает с одним пулом, если 5 → с пятью и т.д.
4. Jupiter «шлагбаум» (Route Gate)
Первый фильтр: route-and-impact.filter.ts.
Делает запрос к Jupiter API /quote: – inputMint=WSOL, outputMint=baseMint, amount=<планируемая покупка> (не символическая, а реальная сумма из логики покупки). – Проверяет, что маршрут существует. – Проверяет, что price impact ≤ MAX_PRICE_IMPACT_BPS (из .env).
Если условие не выполнено → лог SKIP_ROUTE_NOT_FOUND или SKIP_IMPACT_GT_LIMIT.
5. Фильтры (порядок и логика)
Монета должна пройти все фильтры 2 раза подряд (CONSECUTIVE_FILTER_MATCHES=2) в течение окна FILTER_CHECK_DURATION. Интервал проверок — FILTER_CHECK_INTERVAL.
Порядок:
Route Gate (описан выше).
Mutable — метадата не должна быть изменяемой.
Renounced / Freeze — у минта нет mint authority и freeze authority.
Token-2022 Deny — если токен = Token-2022, проверяем расширения; если в списке DENY_TOKEN2022_EXTENSIONS → скипаем.
Socials — в метадате должна быть хотя бы 1–2 соцсети (порог регулируется .env).
Image/GIF — в метадате должна быть валидная картинка/гиф.
Pool Size — размер пула в диапазоне [MIN_POOL_SIZE … MAX_POOL_SIZE].
Pool Age — пул младше POOL_MAX_AGE_MS.
Holder Concentration — топ-1 ≤ 20%, топ-5 ≤ 35%.
LP Protection — проверка локов:
Если top-1 владелец LP аккаунта принадлежит whitelisted локеру → считаем LOCK.
Если LOCK нет → ждём до LP_LOCK_DEADLINE_MS (например, 15 минут), каждые LP_RECHECK_INTERVAL_MS проверяем.
Если так и нет → проверяем BURN fallback (≥50% LP сожжено).
Если условия не выполнены → SKIP_NO_LOCK_15M или SKIP_BURN_TOO_LOW.
(все параметры в файле .env должны быть настраиваемые и изменяемые) 

6. Покупка (BUY)
Если монета стабильно прошла все фильтры → бот делает re-quote на Jupiter (WSOL→Token, на реальную сумму).
Строит транзакцию через /swap.
Перед отправкой делает simulateTransaction (если ошибка → re-quote ещё раз).
Отправляет, логирует BUY_SUCCESS или JUP_TX_SEND_FAIL.
7. Продажа (SELL)
Если AUTO_SELL=true: – бот каждые PRICE_CHECK_INTERVAL проверяет цену, максимум до PRICE_CHECK_DURATION. – при стоп-лоссе или тейк-профите → снова делает re-quote (Token→WSOL), строит транзу, отправляет. – до MAX_SELL_RETRIES попыток. – AUTO_SELL_DELAY можно добавить задержку перед отправкой.
Если AUTO_SELL=false — только мониторинг и лог.
8. Логирование
Каждый шаг логируется коротким кодом: – DETECTED_POOL, SKIP_*, BUY_*, SELL_*, LP_LOCK_OK, LP_BURN_OK.
Всё должно быть максимально прозрачно для отладки.
9. Настройки через .env
Пример:
# Основное
PRIVATE_KEY=...
RPC_ENDPOINT=https://...
MAX_TOKENS_AT_THE_TIME=3

# Фильтры
FILTER_CHECK_DURATION=50000
FILTER_CHECK_INTERVAL=3000
CONSECUTIVE_FILTER_MATCHES=2
MIN_POOL_SIZE=80
MAX_POOL_SIZE=500
POOL_MAX_AGE_MS=36000000

# Холдеры
HOLDERS_TOP1_MAX_RATIO=0.07
HOLDERS_TOP5_MAX_RATIO=0.2

# LP защита
REQUIRE_LP_PROTECTION=true
LP_LOCKER_PROGRAM_WHITELIST=...
LP_LOCKED_MIN_RATIO_BPS=9000
LP_BURN_MIN_RATIO_BPS=5000
LP_LOCK_DEADLINE_MS=900000
LP_RECHECK_INTERVAL_MS=60000

# Jupiter
JUPITER_BASE_URL=https://quote-api.jup.ag
JUPITER_TTL_MS=7000
JUPITER_MAX_STEPS=4
BUY_SLIPPAGE_BPS=300
MAX_PRICE_IMPACT_BPS=200

# Автопродажа
AUTO_SELL=true
MAX_SELL_RETRIES=5
AUTO_SELL_DELAY=0
PRICE_CHECK_INTERVAL=2000
PRICE_CHECK_DURATION=200000

Человеческое описание (для понимания результата)
Бот слушает новые токены на Raydium, Meteora, PumpSwap.
Сразу отбрасывает всё, что не торгуется против SOL.
Перед проверками спрашивает Jupiter: «Можно ли купить SOL→этот токен без жёсткого перекоса?»
Если можно — токен проходит цепочку фильтров: – нельзя менять метадату, – нет админских ключей, – есть соцсети, – есть картинка, – пул свежий и нормального размера, – нет перекоса у холдеров, – ликвидка защищена (LOCK или BURN).
Если токен всё это прошёл → бот его покупает за SOL.
После покупки бот следит за ценой: - работает до стоп лосса\тейк профита или таймера, параметр времени на сделку указывается в .env, по истечении времени – продажа – при росте до цели — продаёт в плюс, – при падении до стопа — продаёт в минус, – если авто-селл выключен — просто пишет в логи.
Когда работа с этим токеном закончена, бот берёт следующий.
В логах всегда видно: – какой токен найден, – почему отсеян (SKIP_*), – когда куплен, – когда и как продан.
Результат: бот автоматически ловит новые токены на SOL-парах, проверяет их на честность, покупает только «живые», продаёт по условиям, и всё это делает сам.
