function normalizeDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return {};
  }
  return details;
}

export class HttpError extends Error {
  constructor(status, type, code, message, details = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.type = type;
    this.code = code;
    this.details = normalizeDetails(details);
  }
}

export class ProjectLoadError extends Error {
  constructor(message, diagnostics = [message], details = {}) {
    super(message);
    this.name = 'ProjectLoadError';
    this.diagnostics = Array.isArray(diagnostics) && diagnostics.length ? diagnostics : [message];
    this.details = normalizeDetails(details);
  }
}

export function errorPayload(error) {
  const type = error instanceof HttpError ? error.type : 'internal_error';
  const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
  const message = error?.message || 'Internal server error.';
  const details = normalizeDetails(error?.details);
  return {
    error: {
      type,
      code,
      message,
      details
    }
  };
}
