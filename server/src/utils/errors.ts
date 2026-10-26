export class AppError extends Error {
  status: number;
  code: string;
  field?: string;

  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export const badRequest = (message: string, field?: string) =>
  new AppError(400, 'VALIDATION_ERROR', message, field);

export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have permission to do that') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Resource not found') =>
  new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string, field?: string) =>
  new AppError(409, 'CONFLICT', message, field);

export function assertFound<T>(value: T | null | undefined, message?: string): T {
  if (value === null || value === undefined) throw notFound(message);
  return value;
}
