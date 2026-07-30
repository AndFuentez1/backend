import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase module before importing service
vi.mock('../../config/supabase.config.js', () => {
    const mockFrom = vi.fn();
    return {
        default: {
            from: mockFrom
        }
    };
});

import supabase from '../../config/supabase.config.js';
import {
    saveTelegramConfig,
    loadTelegramConfig,
    getUserConfigStatus,
    markTelegramVerified,
    deleteTelegramConfig
} from '../userConfig.service.js';
import { encrypt, decrypt } from '../encryption.service.js';

describe('userConfig.service - Telegram agent state & persistence', () => {
    const testUserId = 'test-user-uuid-9999';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should save encrypted telegram config and reset verification when credentials are provided', async () => {
        const mockSingle = vi.fn().mockResolvedValue({
            data: { email: 'user@example.com', telegram_bot_token: null, telegram_chat_id: null },
            error: null
        });
        const mockSelect = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: mockSingle }) });
        const mockUpsert = vi.fn().mockResolvedValue({ error: null });

        vi.mocked(supabase.from).mockImplementation((table: string) => {
            if (table === 'user_configs') {
                return {
                    select: mockSelect,
                    upsert: mockUpsert
                } as any;
            }
            return {} as any;
        });

        const botToken = '123456:ABC-DEF-BotToken';
        const chatId = '987654321';

        await saveTelegramConfig(testUserId, botToken, chatId, true, false, 'user@example.com');

        expect(supabase.from).toHaveBeenCalledWith('user_configs');
        expect(mockUpsert).toHaveBeenCalledTimes(1);

        const upsertPayload = mockUpsert.mock.calls[0][0];
        expect(upsertPayload.id).toBe(testUserId);
        expect(upsertPayload.telegram_chat_id).toBe(chatId);
        expect(upsertPayload.notify_rules_exceptions).toBe(true);
        expect(upsertPayload.notify_ai_exceptions).toBe(false);
        expect(upsertPayload.telegram_verified_at).toBeNull();

        // Verify token was encrypted
        expect(upsertPayload.telegram_bot_token).not.toBe(botToken);
        const decrypted = await decrypt(upsertPayload.telegram_bot_token, testUserId);
        expect(decrypted).toBe(botToken);
    });

    it('should load and decrypt telegram config correctly for authenticated userId', async () => {
        const botToken = '123456:SecretToken';
        const encryptedToken = await encrypt(botToken, testUserId);

        const mockSingle = vi.fn().mockResolvedValue({
            data: {
                telegram_bot_token: encryptedToken,
                telegram_chat_id: '123456',
                notify_rules_exceptions: true,
                notify_ai_exceptions: false
            },
            error: null
        });

        const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });

        vi.mocked(supabase.from).mockImplementation(() => ({
            select: mockSelect
        } as any));

        const config = await loadTelegramConfig(testUserId);

        expect(mockEq).toHaveBeenCalledWith('id', testUserId);
        expect(config).toBeDefined();
        expect(config?.botToken).toBe(botToken);
        expect(config?.chatId).toBe('123456');
        expect(config?.notifyRulesExceptions).toBe(true);
    });

    it('should return safe status without leaking credentials in getUserConfigStatus', async () => {
        const mockSingle = vi.fn().mockResolvedValue({
            data: {
                id: testUserId,
                email: 'test@example.com',
                telegram_configured_at: '2026-02-15T10:00:00Z',
                telegram_verified_at: '2026-02-15T10:05:00Z',
                notify_rules_exceptions: true,
                notify_ai_exceptions: false,
                cashflow_use_real_balance: true
            },
            error: null
        });

        vi.mocked(supabase.from).mockImplementation(() => ({
            select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: mockSingle }) })
        } as any));

        const status = await getUserConfigStatus(testUserId);

        expect(status.telegramConfigured).toBe(true);
        expect(status.telegramVerified).toBe(true);
        expect(status.notifyRulesExceptions).toBe(true);
        expect(status.notifyAiExceptions).toBe(false);
        expect(status.cashflowUseRealBalance).toBe(true);
        // Ensure sensitive tokens are NOT returned in status
        expect((status as any).telegram_bot_token).toBeUndefined();
        expect((status as any).botToken).toBeUndefined();
    });

    it('should update telegram_verified_at timestamp in markTelegramVerified', async () => {
        const mockEq = vi.fn().mockResolvedValue({ error: null });
        const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });

        vi.mocked(supabase.from).mockImplementation(() => ({
            update: mockUpdate
        } as any));

        await markTelegramVerified(testUserId);

        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            telegram_verified_at: expect.any(String)
        }));
        expect(mockEq).toHaveBeenCalledWith('id', testUserId);
    });

    it('should nullify telegram credentials in deleteTelegramConfig', async () => {
        const mockEq = vi.fn().mockResolvedValue({ error: null });
        const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });

        vi.mocked(supabase.from).mockImplementation(() => ({
            update: mockUpdate
        } as any));

        await deleteTelegramConfig(testUserId);

        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            telegram_bot_token: null,
            telegram_chat_id: null,
            telegram_configured_at: null,
            telegram_verified_at: null,
            notify_rules_exceptions: false,
            notify_ai_exceptions: false
        }));
        expect(mockEq).toHaveBeenCalledWith('id', testUserId);
    });
});
