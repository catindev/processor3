function stateExample() {
  return {
    processId: 'proc-1',
    id: 'beneficiary.registration.v3',
    version: '1.0.0',
    status: 'ACTIVE',
    traceMode: 'basic',
    currentStepId: 'validate_fl_resident_request',
    currentStepType: 'PROCESS',
    currentStepSubtype: 'RULES',
    context: {
      input: {
        application: {
          beneficiary: {
            type: 'FL_RESIDENT',
            inn: '744404355804'
          }
        },
        currentDate: '2026-04-12'
      },
      checks: {},
      facts: {},
      decisions: {},
      steps: {},
      effects: {}
    },
    history: [],
    result: null,
    meta: {
      artifactSetId: 'beneficiary-registration-v3',
      artifactSetVersion: '1.0.0'
    }
  };
}

export function createOpenApiDocument() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Processor3 API — заявки по бенефициарам',
      version: '2.0.0',
      description: 'HTTP API процессора потока данных для обработки заявок по бенефициарам номинальных счетов.'
    },
    paths: {
      '/health': {
        get: {
          summary: 'Read processor readiness and artifact runtime status',
          responses: {
            '200': {
              description: 'Processor runtime is ready.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthResponse' }
                }
              }
            },
            '503': {
              description: 'Processor runtime is not ready.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthResponse' }
                }
              }
            }
          }
        }
      },
      '/init': {
        post: {
          summary: 'Create initial workflow state',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/InitRequest' },
                example: {
                  processId: 'proc-1',
                  flowId: 'beneficiary.registration.v3',
                  flowVersion: '1.0.0',
                  input: {
                    application: {
                      beneficiary: {
                        type: 'FL_RESIDENT',
                        inn: '744404355804'
                      }
                    },
                    currentDate: '2026-04-12'
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Workflow state created.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StateResponse' }
                }
              }
            },
            '400': { $ref: '#/components/responses/RequestError' },
            '503': { $ref: '#/components/responses/RuntimeUnavailable' }
          }
        }
      },
      '/step': {
        post: {
          summary: 'Plan the current normalized step without mutating state',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StateCommand' }
              }
            }
          },
          responses: {
            '200': {
              description: 'Current normalized step.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StepResponse' },
                  examples: {
                    processStep: {
                      value: {
                        step: {
                          id: 'validate_fl_resident_request',
                          type: 'PROCESS',
                          subtype: 'RULES',
                          artefactId: 'validation',
                          input: {}
                        }
                      }
                    },
                    controlStep: {
                      value: {
                        step: {
                          id: 'route_after_validation',
                          type: 'CONTROL',
                          subtype: 'ROUTE',
                          selectedNextStepId: 'validate_fl_resident_request'
                        }
                      }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/RequestError' },
            '409': { $ref: '#/components/responses/RuntimeError' },
            '503': { $ref: '#/components/responses/RuntimeUnavailable' }
          }
        }
      },
      '/run': {
        post: {
          summary: 'Execute the current PROCESS step resolved from state',
          description: 'The processor reads the current step from the provided state. No stepId or step object is accepted.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StateCommand' }
              }
            }
          },
          responses: {
            '200': {
              description: 'PROCESS step executed and reduced into new state.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StateResponse' }
                }
              }
            },
            '400': { $ref: '#/components/responses/RequestError' },
            '409': { $ref: '#/components/responses/RuntimeError' },
            '503': { $ref: '#/components/responses/RuntimeUnavailable' }
          }
        }
      },
      '/route': {
        post: {
          summary: 'Reduce the current CONTROL step resolved from state',
          description: 'The processor reads the current step from the provided state. No stepId or step object is accepted.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StateCommand' }
              }
            }
          },
          responses: {
            '200': {
              description: 'CONTROL step reduced into new state.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StateResponse' }
                }
              }
            },
            '400': { $ref: '#/components/responses/RequestError' },
            '409': { $ref: '#/components/responses/RuntimeError' },
            '503': { $ref: '#/components/responses/RuntimeUnavailable' }
          }
        }
      },
      '/apply': {
        post: {
          summary: 'Apply external EFFECT result to current workflow state',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApplyRequest' },
                example: {
                  state: stateExample(),
                  stepId: 'run_abs_subflow',
                  effectResult: {
                    requestId: 'req-1',
                    result: { accepted: true },
                    error: null,
                    errorCode: null
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Effect result applied.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StateResponse' }
                }
              }
            },
            '400': { $ref: '#/components/responses/RequestError' },
            '409': { $ref: '#/components/responses/RuntimeError' },
            '503': { $ref: '#/components/responses/RuntimeUnavailable' }
          }
        }
      },
      '/resume': {
        post: {
          summary: 'Resume current WAIT step with external result',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ResumeRequest' },
                example: {
                  state: stateExample(),
                  stepId: 'wait_abs_subflow',
                  waitResult: {
                    requestId: 'req-1',
                    result: { status: 'COMPLETE' },
                    error: null,
                    errorCode: null
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Wait result applied and workflow resumed.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StateResponse' }
                }
              }
            },
            '400': { $ref: '#/components/responses/RequestError' },
            '409': { $ref: '#/components/responses/RuntimeError' },
            '503': { $ref: '#/components/responses/RuntimeUnavailable' }
          }
        }
      }
    },
    components: {
      responses: {
        RequestError: {
          description: 'Request payload is invalid.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' }
            }
          }
        },
        RuntimeError: {
          description: 'Workflow step type or workflow state is invalid for the requested operation.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' }
            }
          }
        },
        RuntimeUnavailable: {
          description: 'Processor runtime is not ready because artifact bootstrap failed.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' }
            }
          }
        }
      },
      schemas: {
        InitRequest: {
          type: 'object',
          required: ['processId', 'input'],
          properties: {
            processId: { type: 'string' },
            flowId: { type: 'string' },
            flowVersion: { type: 'string' },
            input: {
              type: 'object',
              required: ['application'],
              properties: {
                application: {
                  type: 'object',
                  additionalProperties: true
                },
                currentDate: {
                  type: 'string',
                  description: 'Current business date in YYYY-MM-DD format.'
                }
              },
              additionalProperties: false
            }
          },
          additionalProperties: false
        },
        StateCommand: {
          type: 'object',
          required: ['state'],
          properties: {
            state: { $ref: '#/components/schemas/ProcessState' }
          },
          additionalProperties: false
        },
        ApplyRequest: {
          type: 'object',
          required: ['state', 'stepId', 'effectResult'],
          properties: {
            state: { $ref: '#/components/schemas/ProcessState' },
            stepId: { type: 'string' },
            effectResult: { $ref: '#/components/schemas/ExternalResult' }
          },
          additionalProperties: false
        },
        ResumeRequest: {
          type: 'object',
          required: ['state', 'stepId', 'waitResult'],
          properties: {
            state: { $ref: '#/components/schemas/ProcessState' },
            stepId: { type: 'string' },
            waitResult: { $ref: '#/components/schemas/ExternalResult' }
          },
          additionalProperties: false
        },
        StateResponse: {
          type: 'object',
          required: ['state'],
          properties: {
            state: { $ref: '#/components/schemas/ProcessState' }
          },
          example: {
            state: stateExample()
          }
        },
        StepResponse: {
          type: 'object',
          required: ['step'],
          properties: {
            step: { $ref: '#/components/schemas/NormalizedStep' }
          }
        },
        HealthResponse: {
          type: 'object',
          required: ['status', 'artifactRuntime'],
          properties: {
            status: {
              type: 'string',
              enum: ['ready', 'not_ready']
            },
            artifactRuntime: {
              type: 'object',
              required: ['ready', 'defaultFlow', 'flows', 'diagnostics'],
              properties: {
                ready: { type: 'boolean' },
                defaultFlow: {
                  type: 'object',
                  required: ['flowId', 'flowVersion'],
                  properties: {
                    flowId: { type: 'string' },
                    flowVersion: { type: 'string', nullable: true }
                  }
                },
                flows: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['flowId', 'flowVersion', 'artifactSetId', 'artifactSetVersion'],
                    properties: {
                      flowId: { type: 'string' },
                      flowVersion: { type: 'string' },
                      artifactSetId: { type: 'string' },
                      artifactSetVersion: { type: 'string' }
                    }
                  }
                },
                diagnostics: {
                  type: 'array',
                  items: { type: 'string' }
                }
              }
            }
          }
        },
        ErrorResponse: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['type', 'code', 'message', 'details'],
              properties: {
                type: {
                  type: 'string',
                  enum: ['request_error', 'runtime_error', 'runtime_unavailable', 'deprecated_endpoint', 'internal_error']
                },
                code: { type: 'string' },
                message: { type: 'string' },
                details: {
                  type: 'object',
                  additionalProperties: true
                }
              }
            }
          }
        },
        ExternalResult: {
          type: 'object',
          required: ['requestId'],
          properties: {
            requestId: { type: 'string' },
            result: {
              nullable: true,
              description: 'JSON-safe business result payload. Domain-negative outcomes such as NOT_FOUND or ADDRESS_INVALID must be transferred here, not in error.'
            },
            error: {
              nullable: true,
              description: 'JSON-safe infrastructure error payload. Use only for call/wait transport failures and runtime faults of external interaction.'
            },
            errorCode: { type: 'string', nullable: true }
          },
          additionalProperties: false
        },
        ProcessState: {
          type: 'object',
          required: [
            'processId',
            'id',
            'version',
            'status',
            'traceMode',
            'currentStepId',
            'currentStepType',
            'currentStepSubtype',
            'context',
            'history',
            'result',
            'meta'
          ],
          properties: {
            processId: { type: 'string' },
            id: { type: 'string' },
            version: { type: 'string' },
            status: { type: 'string' },
            traceMode: {
              type: 'string',
              enum: ['off', 'basic', 'verbose']
            },
            currentStepId: { type: 'string' },
            currentStepType: { type: 'string' },
            currentStepSubtype: { type: 'string' },
            context: {
              type: 'object',
              properties: {
                input: { type: 'object', additionalProperties: true },
                checks: { type: 'object', additionalProperties: true },
                facts: { type: 'object', additionalProperties: true },
                decisions: { type: 'object', additionalProperties: true },
                steps: { type: 'object', additionalProperties: true },
                effects: { type: 'object', additionalProperties: true }
              },
              additionalProperties: true
            },
            history: {
              type: 'array',
              items: { type: 'object', additionalProperties: true }
            },
            result: {
              nullable: true,
              description: 'Финальный предметный результат процесса. Для FAIL-веток содержит merchant-friendly outcome, reasonCode, merchantMessage и errors. В preprod errors может временно содержать расширенные issue-объекты.'
            },
            meta: {
              type: 'object',
              additionalProperties: true
            }
          }
        },
        NormalizedStep: {
          type: 'object',
          required: ['id', 'type', 'subtype'],
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            subtype: { type: 'string' },
            artefactId: { type: 'string' },
            input: { type: 'object', additionalProperties: true },
            selectedNextStepId: { type: 'string' },
            operationId: { type: 'string' },
            sourceStepId: { type: 'string' },
            request: { type: 'object', additionalProperties: true }
          },
          additionalProperties: true
        }
      }
    }
  };
}
