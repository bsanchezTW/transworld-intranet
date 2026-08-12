class StorageServiceError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "StorageServiceError";
    this.code = options.code || "STORAGE_ERROR";
    this.statusCode = options.statusCode || 500;
    this.operation = options.operation;
    this.relativePath = options.relativePath;
    this.retryable = Boolean(options.retryable);
    this.details = options.details;
  }
}

class StorageNotFoundError extends StorageServiceError {
  constructor(relativePath, options = {}) {
    super(`No existe el objeto de Storage: ${relativePath}`, {
      ...options,
      code: "STORAGE_NOT_FOUND",
      statusCode: 404,
      relativePath,
    });
    this.name = "StorageNotFoundError";
  }
}

class StorageConflictError extends StorageServiceError {
  constructor(relativePath, options = {}) {
    super(`El objeto de Storage ya existe: ${relativePath}`, {
      ...options,
      code: "STORAGE_CONFLICT",
      statusCode: 409,
      relativePath,
    });
    this.name = "StorageConflictError";
  }
}

class StorageValidationError extends StorageServiceError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: options.code || "STORAGE_VALIDATION_ERROR",
      statusCode: options.statusCode || 400,
    });
    this.name = "StorageValidationError";
  }
}

class StoragePathError extends StorageValidationError {
  constructor(message = "Ruta relativa inválida", options = {}) {
    super(message, { ...options, code: "STORAGE_INVALID_PATH" });
    this.name = "StoragePathError";
  }
}

class StoragePartialFailureError extends StorageServiceError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: "STORAGE_PARTIAL_FAILURE",
      statusCode: options.statusCode || 502,
    });
    this.name = "StoragePartialFailureError";
    this.deletedPaths = options.deletedPaths || [];
    this.pendingPaths = options.pendingPaths || [];
  }
}

function getStatusCode(error) {
  // StorageApiError usa a veces `statusCode` para un código simbólico
  // (p. ej. "NoSuchKey") y conserva el HTTP real en `status`.
  const candidates = [
    error?.statusCode,
    error?.status,
    error?.originalError?.statusCode,
    error?.originalError?.status,
  ];
  for (const candidate of candidates) {
    const status = Number(candidate);
    if (Number.isInteger(status) && status >= 100 && status <= 599) {
      return status;
    }
  }
  return 500;
}

function toStorageError(error, context = {}) {
  if (error instanceof StorageServiceError) return error;

  const statusCode = getStatusCode(error);
  if (statusCode === 404) {
    return new StorageNotFoundError(context.relativePath || "", {
      cause: error,
      operation: context.operation,
    });
  }
  if (statusCode === 409) {
    return new StorageConflictError(context.relativePath || "", {
      cause: error,
      operation: context.operation,
    });
  }

  return new StorageServiceError(
    error?.message || "Error desconocido en Supabase Storage",
    {
      cause: error,
      code: error?.code || "STORAGE_PROVIDER_ERROR",
      statusCode,
      operation: context.operation,
      relativePath: context.relativePath,
      retryable: statusCode === 429 || statusCode >= 500,
      details: error?.details,
    },
  );
}

module.exports = {
  StorageServiceError,
  StorageNotFoundError,
  StorageConflictError,
  StorageValidationError,
  StoragePathError,
  StoragePartialFailureError,
  getStatusCode,
  toStorageError,
};
