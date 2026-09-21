import { z } from 'zod';

/** Formato uniforme de los errores de Zod para la API (campo + motivo). */
export interface ZodIssueSummary {
  field: string;
  message: string;
}

export function summarizeZodIssues(error: z.ZodError): ZodIssueSummary[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(raíz)',
    message: issue.message,
  }));
}
