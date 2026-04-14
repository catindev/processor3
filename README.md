# Processor3 — процессор потока данных по заявкам бенефициаров

`processor3` — это сервис обработки заявок по бенефициарам номинальных счетов. Он исполняет шаги бизнес-процесса регистрации и проверки бенефициара, возвращает новое состояние workflow и формирует прикладной результат, пригодный для внешнего статуса мерчанта.

В текущем контуре сервис покрывает PoC-сценарий регистрации **ФЛ-резидента** и используется как Node-процессор рядом с Java-оркестратором.

## Что делает сервис

Сервис:

- создаёт начальное состояние процесса по заявке;
- определяет текущий шаг процесса;
- выполняет внутренние шаги обработки `PROCESS`;
- продвигает маршрутизирующие шаги `CONTROL`;
- применяет результаты внешних вызовов `EFFECT`;
- продолжает процесс по результатам `WAIT`;
- возвращает финальный прикладной результат процесса.

Сервис не хранит жизненный цикл workflow целиком и не владеет инфраструктурой исполнения.

## Место в архитектуре

### Java-оркестратор

Оркестратор отвечает за:

- хранение состояния workflow;
- очереди, ретраи и recovery;
- ожидание внешних результатов;
- корреляцию ответов;
- публикацию внешнего статуса заявки.

### Node-процессор `processor3`

Процессор отвечает за:

- каноническое продвижение состояния процесса;
- исполнение внутренних шагов на основе артефактов;
- формирование финального предметного результата заявки;
- проверку готовности артефактов на старте.

### Артефакты процесса

В артефактах живёт прикладная логика:

- `flow` описывает шаги и маршруты;
- `rules` возвращают сырой результат проверок;
- `mappings` интерпретируют его в устойчивые факты и режим ответа;
- `decisions` выбирают исход ветки процесса.

Именно поэтому дальнейшее развитие процессинга должно происходить в основном через артефакты, а не через сервисный код.

## Какой бизнес-процесс реализован сейчас

Текущий основной flow — `beneficiary.registration.v3@1.0.0`.

Он покрывает happy path:

1. определить поддерживаемый сценарий заявки;
2. провалидировать заявку на регистрацию бенефициара;
3. интерпретировать результат проверок в прикладные факты;
4. принять решение: отклонить заявку или продолжать процесс;
5. проверить адрес;
6. вызвать ABS-сабфлоу по созданию/поиску/привязке бенефициара;
7. завершить процесс предметным результатом.

Текущий сабфлоу — `abs.ensure_fl_resident_beneficiary@1.0.0`.

## Прикладные исходы процесса

Процессор хранит:

- сырой результат правил в `context.checks`;
- интерпретированные факты в `context.facts`;
- решение в `context.decisions`;
- финальный предметный результат в `state.result`.

Для validation-ветки наружу разведены как минимум два разных отказа:

- `COMPLIANCE_REJECT` — заявка отклонена по регуляторной причине;
- `VALIDATION_REJECT` — заявка отклонена, есть ошибки в данных.

Пример merchant-friendly результата для validation reject:

```json
{
  "status": "FAIL",
  "outcome": "VALIDATION_REJECT",
  "reasonCode": "VALIDATION_ERROR",
  "merchantMessage": "Заявка отклонена. Есть ошибки",
  "responseMode": "DETAILED_ERRORS",
  "errors": [
    {
      "code": "BEN.IDDOC.ISSUE_DATE.NOT_FUTURE",
      "message": "Дата выдачи документа не должна быть больше текущей даты",
      "field": "beneficiary.idDoc.issueDate"
    }
  ]
}
```

В preprod-варианте массив `errors` может содержать расширенные issue-объекты из rules-runtime. Для внешнего результата здесь гарантируются как минимум `code`, `message` и `field`, если поле присутствует в исходной ошибке.

Пример merchant-friendly результата для compliance reject:

```json
{
  "status": "FAIL",
  "outcome": "COMPLIANCE_REJECT",
  "reasonCode": "REGULATORY_REJECT",
  "merchantMessage": "Заявка отклонена по регуляторной причине",
  "responseMode": "GENERALIZED_ERROR",
  "errors": []
}
```

Оркестратор не должен сам заново интерпретировать `checks.issues[]` для определения типа отказа. Он должен читать уже сформированный `state.result`.

## HTTP API

Публичные runtime-ручки:

- `POST /init`
- `POST /step`
- `POST /run`
- `POST /route`
- `POST /apply`
- `POST /resume`
- `GET /health`

Документация:

- `GET /openapi.json`
- `GET /docs`

Устаревшая ручка:

- `POST /execute` — tombstone, всегда возвращает `410 ENDPOINT_DEPRECATED`

### Что делают ручки

- `/init` — создаёт начальное состояние процесса;
- `/step` — возвращает текущий нормализованный шаг без изменения состояния;
- `/run` — выполняет только текущий шаг верхнего типа `PROCESS`;
- `/route` — продвигает только текущий шаг верхнего типа `CONTROL`;
- `/apply` — применяет результат внешнего `EFFECT`;
- `/resume` — продолжает процесс по результату `WAIT`.

`/run` и `/route` работают только от переданного `state`. Они не принимают `stepId` или `step`.

## Readiness и артефакты

На старте сервис:

- читает все artifact sets;
- валидирует flow;
- подготавливает rules, mappings и decisions;
- проверяет ссылки между flow и артефактами;
- собирает version-aware runtime registry.

Если набор артефактов некорректен, сервис не входит в рабочий режим:

- `GET /health` возвращает `503` и `status: "not_ready"`;
- рабочие runtime-ручки отвечают `503 PROJECT_NOT_READY`;
- причина неготовности видна в diagnostics.

Пример ответа `/health`:

```json
{
  "status": "ready",
  "artifactRuntime": {
    "ready": true,
    "defaultFlow": {
      "flowId": "beneficiary.registration.v3",
      "flowVersion": "1.0.0"
    },
    "flows": [
      {
        "flowId": "beneficiary.registration.v3",
        "flowVersion": "1.0.0",
        "artifactSetId": "beneficiary-registration-v3",
        "artifactSetVersion": "1.0.0"
      }
    ],
    "diagnostics": []
  }
}
```

## Как сервис решает задачу технически

Внутри сервис использует ProcessEngine-стек:

- `@processengine/semantics` — каноническое продвижение состояния;
- `@processengine/rules` — выполнение правил;
- `@processengine/mappings` — интерпретация результатов и нормализация данных;
- `@processengine/decisions` — выбор outcome.

Это внутренняя реализация. Для интегратора важнее то, что сервис является процессором потока данных по заявкам и возвращает пригодный прикладной результат.

## Структура артефактов

Основной flow:

- `artifacts/beneficiary-registration-v3`
- flow `beneficiary.registration.v3@1.0.0`

ABS-сабфлоу:

- `artifacts/beneficiary-persist-and-link-v3`
- flow `abs.ensure_fl_resident_beneficiary@1.0.0`

Файловая модель артефактов в этой задаче сохранена. Сервис не переводит их в npm-пакеты и не подменяет административным контуром.

## Локальный запуск

```bash
npm install
PROCESSOR_DEFAULT_FLOW_ID=beneficiary.registration.v3 \
PROCESSOR_DEFAULT_FLOW_VERSION=1.0.0 \
PORT=3000 \
node src/server.js
```

Переменные окружения:

```bash
PORT=3000
PROCESSOR_TRACE_MODE=basic
PROCESSOR_ARTIFACT_DIR=./artifacts
PROCESSOR_ARTIFACT_SET=artifact-set.v3.json
PROCESSOR_DEFAULT_FLOW_ID=beneficiary.registration.v3
PROCESSOR_DEFAULT_FLOW_VERSION=1.0.0
PROCESSOR_LOG_DIR=./processlogs
```

Swagger UI: `http://localhost:3000/docs`  
OpenAPI JSON: `http://localhost:3000/openapi.json`

## Проверки

Юнит-тесты:

```bash
npm test
```

Smoke-проверка happy path:

```bash
npm run smoke
```

Сейчас smoke подтверждает:

- основной flow завершается `COMPLETE / BENEFICIARY_REGISTERED`;
- ABS-сабфлоу завершается `COMPLETE / ABS_ENSURE_BENEFICIARY_DONE`.

## Что дожать после preprod

Текущий beneficiary-flow уже должен собирать готовый прикладной `terminalResult` в артефактах. Процессор не должен интерпретировать `checks`, классифицировать отказы, фильтровать `issues[]` или собирать merchant-ответ по частям. Его допустимая роль в этом месте — только механически копировать заранее подготовленный `context.facts.terminalResult` в `state.result`.

Временный компромисс для preprod:

- допускается, что `terminalResult.errors` содержит более богатые issue-объекты, чем целевой узкий merchant-формат;
- это лучше, чем собирать `errors[]` в `process-kernel` и тащить бизнес-логику в host layer.

Отдельная следующая задача после preprod — расширить канон `Flow3` и/или DSL `mappings`, чтобы финальный `state.result` можно было формировать полностью артефактно без сервисного workaround и без ограничений статического `TERMINAL.result`.
