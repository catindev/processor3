# Beneficiary Processor v3

Processor v3 is the HTTP facade over the Flow3 semantics stack for the beneficiaries PoC.

## What the service does

The service is split into two layers:

- **semantics kernel** — canonical lifecycle over prepared flow artifacts:
  - `startProcess(...)`
  - `planStep(...)`
  - `executeStep(...)`
  - `reduceStep(...)`
  - `applyStepEffect(...)`
  - `resumeProcess(...)`
- **HTTP facade** — transport-safe JSON API for host/orchestrator integration:
  - `POST /init`
  - `POST /step`
  - `POST /execute`
  - `POST /apply`
  - `POST /resume`
  - `GET /health`

The processor knows how to execute a process **by canon**. It does not know the business meaning of a beneficiary flow. Business logic stays in artifacts: flow, rules, mappings and decisions.

## Canonical project preparation

At bootstrap the service performs project-level preparation:

- loads all artifact sets from the artifact root
- validates every flow through `@processengine/semantics`
- prepares rules, mappings and decisions
- validates cross-artifact references:
  - `PROCESS/RULES -> rules entrypoint`
  - `PROCESS/MAPPINGS -> prepared mapping`
  - `PROCESS/DECISIONS -> compiled decision set`
  - `EFFECT/SUBFLOW -> registered flowId + flowVersion`
- builds a **version-aware runtime registry**

This closes the gap between plain service wiring and a canonical process-layer runtime.

## Artifact sets bundled in the archive

### Main flow

`artifacts/beneficiary-registration-v3`

- flow: `beneficiary.registration.v3@1.0.0`
- happy path:
  - `CONTROL/ROUTE` by supported scenario
  - `PROCESS/RULES`
  - `PROCESS/MAPPINGS`
  - `PROCESS/DECISIONS`
  - `CONTROL/SWITCH`
  - `EFFECT/CALL` address validation
  - `WAIT/MESSAGE`
  - `PROCESS/MAPPINGS` address result extraction
  - `CONTROL/ROUTE`
  - `EFFECT/SUBFLOW` ABS ensure beneficiary
  - `WAIT/MESSAGE`
  - `TERMINAL/COMPLETE`

### ABS subflow

`artifacts/beneficiary-persist-and-link-v3`

- flow: `abs.ensure_fl_resident_beneficiary@1.0.0`
- happy path:
  - `EFFECT/COMMAND FIND_CLIENT`
  - `WAIT/MESSAGE`
  - `PROCESS/DECISIONS`
  - `CONTROL/SWITCH`
  - `EFFECT/COMMAND CREATE_CLIENT`
  - `WAIT/MESSAGE`
  - `EFFECT/COMMAND BIND_CLIENT`
  - `WAIT/MESSAGE`
  - `TERMINAL/COMPLETE`

## Init contract

The service accepts both envelopes.

### Legacy envelope

```json
{
  "processId": "proc-1",
  "application": {
    "payload": { "beneficiary": {} },
    "context": { "currentDate": "2026-04-12" }
  }
}
```

### Simplified envelope

```json
{
  "processId": "proc-1",
  "application": { "beneficiary": {} },
  "context": { "currentDate": "2026-04-12" }
}
```

Both normalize to:

```json
{
  "input": {
    "application": { ... },
    "currentDate": "2026-04-12"
  }
}
```

You may also pass explicit version-aware routing:

```json
{
  "processId": "proc-1",
  "flowId": "beneficiary.registration.v3",
  "flowVersion": "1.0.0",
  "application": { "beneficiary": {} }
}
```

## Local run

```bash
npm install
PROCESSOR_DEFAULT_FLOW_ID=beneficiary.registration.v3 \
PROCESSOR_DEFAULT_FLOW_VERSION=1.0.0 \
PORT=3000 \
node src/server.js
```

Environment:

```bash
PORT=3000
PROCESSOR_TRACE_MODE=basic
PROCESSOR_ARTIFACT_DIR=./artifacts
PROCESSOR_ARTIFACT_SET=artifact-set.v3.json
PROCESSOR_DEFAULT_FLOW_ID=beneficiary.registration.v3
PROCESSOR_DEFAULT_FLOW_VERSION=1.0.0
PROCESSOR_LOG_DIR=./processlogs
```

## Health

```bash
curl http://localhost:3000/health
```

The response now includes the prepared flows with explicit versions.

## Tests

```bash
npm test
```

The tests cover:

- project-level preparation with version-aware runtime lookup
- canonical `init -> step -> execute` progression for the main flow

## Smoke without HTTP

```bash
node scripts/smoke-v3.mjs
```

The smoke script demonstrates:

- main flow happy path
- ABS subflow happy path
- canonical `SUBFLOW` resume shape where parent `waitResult.result` is the child terminal `state.result`
