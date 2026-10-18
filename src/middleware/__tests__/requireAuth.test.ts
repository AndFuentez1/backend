import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error módulo JS sin tipos
import { createRequireAuth } from '../requireAuth.js';

type MockRes = {
    statusCode: number;
    body: unknown;
    status: (code: number) => MockRes;
    json: (payload: unknown) => MockRes;
};

function mockRes(): MockRes {
    const res: MockRes = {
        statusCode: 200,
        body: undefined,
        status(code) { res.statusCode = code; return res; },
        json(payload) { res.body = payload; return res; },
    };
    return res;
}

const silentLog = { error: vi.fn() };

describe('requireAuth', () => {
    it('responde 401 sin cabecera Authorization', async () => {
        const getUser = vi.fn();
        const middleware = createRequireAuth(getUser, silentLog);
        const res = mockRes();
        const next = vi.fn();

        await middleware({ headers: {}, body: {}, query: {} }, res, next);

        expect(res.statusCode).toBe(401);
        expect(next).not.toHaveBeenCalled();
        expect(getUser).not.toHaveBeenCalled();
    });

    it('responde 401 si el token es inválido', async () => {
        const getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('invalid') });
        const middleware = createRequireAuth(getUser, silentLog);
        const res = mockRes();
        const next = vi.fn();

        await middleware({ headers: { authorization: 'Bearer bad' }, body: {}, query: {} }, res, next);

        expect(res.statusCode).toBe(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('responde 403 si el userId enviado no coincide con el del token', async () => {
        const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'user-a', email: 'a@x.com' } }, error: null });
        const middleware = createRequireAuth(getUser, silentLog);
        const res = mockRes();
        const next = vi.fn();

        await middleware(
            { headers: { authorization: 'Bearer ok' }, body: { userId: 'user-b' }, query: {} },
            res,
            next
        );

        expect(res.statusCode).toBe(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('normaliza userId/email con los valores verificados y continúa', async () => {
        const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'user-a', email: 'a@x.com' } }, error: null });
        const middleware = createRequireAuth(getUser, silentLog);
        const res = mockRes();
        const next = vi.fn();
        const req = { headers: { authorization: 'Bearer ok' }, body: { geminiApiKey: 'k' }, query: {} as Record<string, string> };

        await middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.body).toMatchObject({ userId: 'user-a', email: 'a@x.com', geminiApiKey: 'k' });
        expect(req.query.userId).toBe('user-a');
    });

    it('responde 401 si la verificación lanza una excepción', async () => {
        const getUser = vi.fn().mockRejectedValue(new Error('network'));
        const middleware = createRequireAuth(getUser, silentLog);
        const res = mockRes();
        const next = vi.fn();

        await middleware({ headers: { authorization: 'Bearer ok' }, body: {}, query: {} }, res, next);

        expect(res.statusCode).toBe(401);
        expect(next).not.toHaveBeenCalled();
    });
});
