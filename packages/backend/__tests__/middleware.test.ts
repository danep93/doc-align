import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// We test the middleware logic, mocking Firebase
describe('auth middleware', () => {
  it('returns 401 when no Authorization header', async () => {
    const { authMiddleware } = await import('../src/middleware/auth');
    const req = { headers: {} } as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header has no Bearer token', async () => {
    const { authMiddleware } = await import('../src/middleware/auth');
    const req = { headers: { authorization: 'Basic abc' } } as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    const next = vi.fn() as NextFunction;

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
