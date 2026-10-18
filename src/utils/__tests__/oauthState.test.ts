import { describe, it, expect } from 'vitest';
import {
    signOAuthState,
    verifyOAuthState,
    isAllowedOrigin,
    escapeHtml,
    toScriptLiteral,
    OAUTH_STATE_TTL_MS,
} from '../oauthState.ts';

const SECRET = 'test-secret';

describe('oauthState', () => {
    it('firma y verifica un state válido', () => {
        const token = signOAuthState({ userId: 'u1', email: 'a@x.com', origin: 'https://andfuentez1.github.io' }, SECRET, 1000);
        const payload = verifyOAuthState(token, SECRET, 2000);
        expect(payload).toMatchObject({ userId: 'u1', email: 'a@x.com', origin: 'https://andfuentez1.github.io' });
    });

    it('rechaza un state alterado', () => {
        const token = signOAuthState({ userId: 'u1', email: 'a@x.com' }, SECRET, 1000);
        const [body, sig] = token.split('.');
        const forgedBody = Buffer.from(JSON.stringify({ userId: 'victim', email: 'a@x.com', exp: 9e15, nonce: 'n' })).toString('base64url');
        expect(verifyOAuthState(`${forgedBody}.${sig}`, SECRET, 2000)).toBeNull();
        expect(verifyOAuthState(`${body}.bad`, SECRET, 2000)).toBeNull();
    });

    it('rechaza un state firmado con otro secreto', () => {
        const token = signOAuthState({ userId: 'u1', email: 'a@x.com' }, 'other', 1000);
        expect(verifyOAuthState(token, SECRET, 2000)).toBeNull();
    });

    it('rechaza un state expirado', () => {
        const token = signOAuthState({ userId: 'u1', email: 'a@x.com' }, SECRET, 1000);
        expect(verifyOAuthState(token, SECRET, 1000 + OAUTH_STATE_TTL_MS + 1)).toBeNull();
    });

    it('descarta orígenes no permitidos', () => {
        const token = signOAuthState({ userId: 'u1', email: 'a@x.com', origin: 'https://evil.example' }, SECRET, 1000);
        expect(verifyOAuthState(token, SECRET, 2000)?.origin).toBeNull();
        expect(isAllowedOrigin('https://evil.example')).toBe(false);
        expect(isAllowedOrigin('https://foo.github.io')).toBe(true);
        expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
    });

    it('escapa HTML y literales de script', () => {
        expect(escapeHtml('<img src=x onerror="a">')).toBe('&lt;img src=x onerror=&quot;a&quot;&gt;');
        expect(toScriptLiteral('</script><script>alert(1)</script>')).not.toContain('<');
    });
});
