# Processor v3 — запуск и проверка

## Что внутри
- каноничный process-layer поверх `@processengine/semantics`
- version-aware registry артефактов
- project-level prepare/validation
- основной flow `beneficiary.registration.v3@1.0.0`
- сабфлоу `abs.ensure_fl_resident_beneficiary@1.0.0`
- process logs на `/init`, `/step`, `/execute`, `/apply`, `/resume`
- итоговый HTML лог процесса

## Happy path PoC
1. проверить, что заявка относится к сценарию `FL_RESIDENT`
2. провалидировать заявку rules
3. проверить адрес
4. запустить сабфлоу АБС
5. в сабфлоу пройти `FIND_CLIENT -> NOT_FOUND -> CREATE_CLIENT -> BIND_CLIENT`
6. вернуть child result в parent через `resume(...)`
7. завершить root process в `COMPLETE / BENEFICIARY_REGISTERED`

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
Processor больше не выбирает runtime только по `flowId`.
Если в проекте появится несколько версий одного flow, сервис требует явный `flowVersion`.
