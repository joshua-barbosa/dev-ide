// Helpers compartilhados pelas rotas Express.
//
// Estavam embutidos em index.ts; foram extraídos quando as rotas de conexão
// passaram a precisar dos mesmos comportamentos (envelope de erro e validação
// de campo obrigatório).
import { NextFunction, Request, RequestHandler, Response } from 'express';

/** Envolve um handler async para que rejeições caiam no middleware de erro. */
export const wrap =
  (fn: (req: Request, res: Response) => void | Promise<void>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Campo obrigatório ausente ou inválido: "${field}".`);
  }
  return value;
}

/** Aceita `?path=a&path=b` e devolve sempre um array — ids e caminhos podem conter "/". */
export function queryList(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

/** Middleware final: transforma qualquer erro no envelope {success, data, error}. */
export function errorEnvelope(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  res.status(400).json({ success: false, data: null, error: err.message });
}
