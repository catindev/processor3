# Processor v3 — запуск и проверка

## Что внутри

- каноничный process-layer поверх `@processengine/semantics`
- version-aware registry артефактов
- strict HTTP facade: `/init`, `/step`, `/run`, `/route`, `/apply`, `/resume`
- readiness через `/health`
- OpenAPI на `/openapi.json`
- Swagger UI на `/docs`
- process logs на `/init`, `/step`, `/run`, `/route`, `/execute`, `/apply`, `/resume`
- итоговый HTML лог процесса

## Happy path PoC

1. `/init` создаёт стартовый `ProcessState`
2. `/step` показывает `CONTROL/ROUTE`
3. `/route` переводит процесс в `PROCESS/RULES`
4. `/run` выполняет `RULES`, затем следующие `PROCESS` шаги
5. внешний адресный `EFFECT` применяется через `/apply`
6. child result сабфлоу возвращается через `/resume`
7. root process завершается в `COMPLETE / BENEFICIARY_REGISTERED`

## Запуск

```bash
cd processor3
npm install
PROCESSOR_DEFAULT_FLOW_ID=beneficiary.registration.v3 \
PROCESSOR_DEFAULT_FLOW_VERSION=1.0.0 \
PORT=3000 \
node src/server.js
```

## Health

```bash
curl http://localhost:3000/health
```

При успешной загрузке артефактов сервис отвечает `200` и `status=ready`. Если bootstrap артефактов сломан, сервис остаётся доступен, но отвечает `503` и `status=not_ready`; рабочие runtime-ручки тоже отдают `503 PROJECT_NOT_READY`.

## OpenAPI и Swagger

```bash
curl http://localhost:3000/openapi.json
open http://localhost:3000/docs
```

## Юнит-тесты

```bash
npm test
```

## Smoke-проверка артефактов без HTTP

```bash
node scripts/smoke-v3.mjs
```

Ожидаемо:

- main flow -> `COMPLETE / BENEFICIARY_REGISTERED`
- ABS subflow -> `COMPLETE / ABS_ENSURE_BENEFICIARY_DONE`

## Важное отличие текущей версии

- `PROCESS` и `CONTROL` больше не смешаны в `/execute`
- `/execute` оставлен только как tombstone и всегда отвечает `410`
- `/run` и `/route` работают только от переданного `state`
- если в проекте появится несколько версий одного flow, сервис требует явный `flowVersion`
