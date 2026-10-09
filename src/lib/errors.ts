export class ApiError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message); }
}
export function notFound(entity = 'Resource'): never {
  throw new ApiError(404, 'NOT_FOUND', `${entity} not found.`);
}
export function conflict(message: string): never { throw new ApiError(409, 'CONFLICT', message); }
