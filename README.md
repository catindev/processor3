# Процессор потока данных по заявкам бенефициаров

`processor3` — это сервис обработки заявок по бенефициарам номинальных счетов. Он исполняет шаги бизнес-процесса над текущим состоянием workflow, возвращает новое состояние и формирует финальный прикладной результат, пригодный для внешнего статуса заявки.

В текущем контуре сервис используется как Node-процессор рядом с Java-оркестратором и покрывает preprod-сценарий регистрации бенефициара **ФЛ-резидента**.

## Что делает сервис

Сервис:

- создаёт начальное состояние workflow по входной заявке;
- определяет текущий шаг процесса;
- выполняет внутренние шаги `PROCESS`;
- продвигает шаги `CONTROL`;
- применяет результаты внешних вызовов `EFFECT`;
- завершает `WAIT` внешним результатом и продолжает workflow;
- отдаёт финальный прикладной результат через `state.result`;
- показывает служебную схему flow через UI и graph API.

Сервис **не** владеет полным lifecycle workflow и **не** берёт на себя инфраструктуру исполнения.

## Место в архитектуре

### Java-оркестратор

Оркестратор отвечает за:

- хранение состояния workflow;
- очереди, ретраи и recovery;
- ожидание внешних результатов;
- корреляцию ответов;
- публикацию внешнего статуса заявки;
- внешний HTTP-контракт для мерчанта.

### Node-процессор

Процессор отвечает за:

- каноническое продвижение состояния workflow;
- исполнение внутренних шагов по артефактам процесса;
- применение результата внешнего эффекта и завершение ожидания;
- выдачу финального предметного результата через `state.result`;
- проверку готовности артефактов на старте;
- служебную визуализацию flow для разработки и отладки.

### Артефакты процесса

В артефактах формата Flow3 живёт прикладная логика:

- `flow` описывает шаги и маршруты;
- `rules` возвращают сырой результат проверок;
- `mappings` интерпретируют его в устойчивые факты;
- `decisions` выбирают исход ветки процесса.

Дальнейшее развитие процессинга должно происходить прежде всего через артефакты, а не через сервисный код процессора.

## Какой бизнес-процесс реализован сейчас

Основной flow:

- `beneficiary.registration.v3@1.0.0`

Он покрывает основной сценарий:

1. определить поддерживаемый сценарий заявки;
2. провалидировать заявку на регистрацию бенефициара;
3. интерпретировать результат проверок в прикладные факты;
4. принять решение: отклонить заявку или продолжать процесс;
5. проверить адрес;
6. вызвать ABS-сабфлоу по поиску, созданию и привязке бенефициара;
7. завершить процесс предметным результатом.

Текущий ABS-сабфлоу:

- `abs.ensure_fl_resident_beneficiary@1.0.0`

## Прикладные исходы процесса

Процессор хранит:

- сырой результат правил в `context.checks`;
- интерпретированные факты в `context.facts`;
- решение в `context.decisions`;
- финальный предметный результат в `state.result`.

Для validation-ветки наружу разведены как минимум два разных отказа:

- `COMPLIANCE_REJECT` — заявка отклонена по регуляторной причине;
- `VALIDATION_REJECT` — заявка отклонена, есть ошибки в данных.

### Пример результата для validation reject

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

### Пример результата для compliance reject

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

- `/init` — создаёт начальное состояние workflow;
- `/step` — возвращает текущий нормализованный шаг без изменения состояния;
- `/run` — выполняет только текущий шаг верхнего типа `PROCESS`;
- `/route` — продвигает только текущий шаг верхнего типа `CONTROL`;
- `/apply` — применяет результат внешнего `EFFECT`;
- `/resume` — завершает `WAIT` внешним результатом и продолжает workflow.

`/run` и `/route` работают только от переданного `state`. Они не принимают `stepId` или `step`.

## Служебный UI и graph API

Сервис поднимает отдельный служебный контур для чтения flow:

- `GET /flows` — список доступных flow;
- `GET /flows/{flowId}?version=...` — визуальная схема конкретного flow;
- `GET /api/flows` — список flow в JSON;
- `GET /api/flows/{flowId}?version=...` — graph document для UI.

Это **не** часть публичного runtime-контракта оркестратора. Это сервисный контур для разработки, ревью артефактов и диагностики.

В текущем presentation mode UI:

- показывает основную последовательность и предметные ветки процесса;
- сворачивает `EFFECT -> WAIT` в один interaction-блок;
- скрывает часть error/fail-исходов из самой схемы и показывает их в деталях шага;
- позволяет сохранить схему в PNG из браузера.

## Readiness и артефакты

На старте сервис:

- читает все artifact sets;
- валидирует flow;
- подготавливает `rules`, `mappings` и `decisions`;
- проверяет ссылки между flow и артефактами;
- собирает version-aware runtime registry.

Если набор артефактов некорректен, сервис не входит в рабочий режим:

- `GET /health` возвращает `503` и `status: "not_ready"`;
- рабочие runtime-ручки отвечают `503 PROJECT_NOT_READY`;
- причина неготовности видна в `diagnostics`.

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

## Внутренняя техническая реализация

Внутри сервис использует ProcessEngine-стек:

- `@processengine/semantics` — каноническое продвижение состояния;
- `@processengine/rules` — выполнение правил;
- `@processengine/mappings` — интерпретация результатов и нормализация данных;
- `@processengine/decisions` — выбор outcome.

Для интегратора важнее не внутренняя библиотека, а то, что сервис остаётся stateless-процессором потока данных и возвращает уже подготовленный прикладной результат.

## Структура артефактов

Основной flow:

- `artifacts/beneficiary-registration-v3`
- flow `beneficiary.registration.v3@1.0.0`

ABS-сабфлоу:

- `artifacts/beneficiary-persist-and-link-v3`
- flow `abs.ensure_fl_resident_beneficiary@1.0.0`

Сервис не переводит артефакты в отдельный packaging-формат и не подменяет их отдельным административным контуром.

## Локальный запуск

```bash
npm install
npm run build:ui
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

Swagger UI:

- `http://localhost:3000/docs`

OpenAPI JSON:

- `http://localhost:3000/openapi.json`

Flow UI:

- `http://localhost:3000/flows`

## Проверки

Юнит- и HTTP-тесты:

```bash
npm test
```

Команда сначала пересобирает React UI для `/flows`, затем запускает тесты runtime и служебного flow API.

Smoke-проверка happy path:

```bash
npm run smoke
```

Сейчас smoke подтверждает:

- основной flow завершается `COMPLETE / BENEFICIARY_REGISTERED`;
- ABS-сабфлоу завершается `COMPLETE / ABS_ENSURE_BENEFICIARY_DONE`.

## Важная оговорка по текущей preprod-версии

В текущем preprod-варианте массив `errors` в `state.result` может содержать **расширенные issue-объекты** из результата `rules`, а не окончательно узкий merchant-shape.

Это временный компромисс, связанный с ограничениями текущего `@processengine/mappings` при работе с массивами. Целевой узкий merchant-формат `errors[]` требует отдельной доработки DSL и не должен собираться в коде процессора через повторную интерпретацию `checks.issues[]`.

Оркестратор не должен заново вычислять тип отказа из сырого результата правил. Он должен читать уже сформированный `state.result`.

## Что нужно дожать после preprod

- поддержать в каноне способ динамически привязывать terminal result из state, без сервисного workaround;
- дожать DSL `mappings`, чтобы узкий merchant `errors[]` собирался полностью артефактно;
- при необходимости развести presentation view и execution view как два отдельных режима визуализации.
