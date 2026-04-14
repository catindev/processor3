# Процессор потока данных по заявкам бенефициаров

`processor` это сервис обработки заявок по бенефициарам номинальных счетов. Он исполняет шаги бизнес-процесса над текущим состоянием workflow, возвращает новое состояние и отдаёт готовый прикладной результат, пригодный для внешнего статуса заявки.

В текущем контуре сервис покрывает цели и задачи PoC и сценарии регистрации **ФЛ-резидента** и используется как внешний модуль в виде Node-процессора рядом с Java-оркестратором.

## Что делает сервис

Сервис:

- создаёт начальное состояние workflow по входной заявке;
- определяет текущий шаг процесса;
- выполняет внутренние шаги обработки `PROCESS`;
- продвигает маршрутизирующие шаги `CONTROL`;
- применяет результаты внешних вызовов `EFFECT`;
- завершает `WAIT` внешним результатом и продолжает workflow;
- отдаёт финальный прикладной результат процесса через `state.result`.

Сервис **не** хранит жизненный цикл workflow целиком и **не** владеет инфраструктурой исполнения.

## Место в архитектуре

### Java-оркестратор

Оркестратор отвечает за:

- хранение состояния workflow;
- очереди, ретраи и recovery;
- ожидание внешних результатов;
- корреляцию ответов;
- публикацию внешнего статуса заявки;
- HTTP-контракт для мерчанта.

### Node-процессор

Процессор отвечает за:

- каноническое продвижение состояния workflow;
- исполнение внутренних шагов по артефактам процесса;
- применение результата внешнего эффекта и завершение ожидания;
- выдачу финального предметного результата через `state.result`;
- проверку готовности артефактов на старте.

### Артефакты процесса

В артефактах формата Flow3 живёт прикладная логика:

- `flow` описывает шаги и маршруты;
- `rules` возвращают сырой результат проверок;
- `mappings` интерпретируют его в устойчивые факты и режим ответа;
- `decisions` выбирают исход ветки процесса.

Дальнейшее развитие процессинга будет происходить через артефакты, а не через сервисный код процессора.

## Какой бизнес-процесс реализован сейчас

Текущий основной flow `beneficiary.registration.v3@1.0.0`.

Он покрывает happy path:

1. определить поддерживаемый сценарий заявки;
2. провалидировать заявку на регистрацию бенефициара;
3. интерпретировать результат проверок в прикладные факты;
4. принять решение: отклонить заявку или продолжать процесс;
5. проверить адрес;
6. вызвать ABS-сабфлоу по созданию, поиску и привязке бенефициара;
7. завершить процесс предметным результатом.

Текущий сабфлоу `abs.ensure_fl_resident_beneficiary@1.0.0`.

## Прикладные исходы процесса

Процессор хранит:

- сырой результат правил в `context.checks`;
- интерпретированные факты в `context.facts`;
- решение в `context.decisions`;
- финальный предметный результат в `state.result`.

Для validation-ветки наружу разведены как минимум два разных отказа:

- `COMPLIANCE_REJECT` заявка отклонена по регуляторной причине;
- `VALIDATION_REJECT`заявка отклонена, есть ошибки в данных.

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

### Важная оговорка по текущей preprod-версии

В текущем preprod-варианте массив `errors` может содержать **расширенные issue-объекты** из результата `rules`, а не окончательно узкий merchant-shape.

Это **временный компромисс текущей версии**, связанный с ограничениями текущего `@processengine/mappings` при работе с массивами. Целевой узкий merchant-формат `errors[]` требует отдельной доработки DSL и не должен собираться в коде процессора.

Оркестратор **не должен** сам заново интерпретировать `checks.issues[]` для определения типа отказа. Он должен читать уже сформированный `state.result`.

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

## Как сервис решает задачу технически

Внутри сервис использует ProcessEngine-стек:

- `@processengine/semantics` — каноническое продвижение состояния;
- `@processengine/rules` — выполнение правил;
- `@processengine/mappings` — интерпретация результатов и нормализация данных;
- `@processengine/decisions` — выбор outcome.

Это внутренняя реализация. Для интегратора важнее то, что сервис является процессором потока данных по заявкам и возвращает пригодный прикладной результат, уже подготовленный артефактами процесса.

## Структура артефактов

Основной flow:

- `artifacts/beneficiary-registration-v3`
- flow `beneficiary.registration.v3@1.0.0`

ABS-сабфлоу:

- `artifacts/beneficiary-persist-and-link-v3`
- flow `abs.ensure_fl_resident_beneficiary@1.0.0`

Файловая модель артефактов в этой задаче сохранена. Сервис не переводит их в `npm`-пакеты и не подменяет отдельным административным контуром.

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
