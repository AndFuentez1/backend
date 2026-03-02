import supabase from '../config/supabase.config.js';
import { encrypt, decrypt, encryptJSON, decryptJSON } from './encryption.service.js';
import logger from '../utils/logger.js';

const DEFAULT_CONFIG_STATUS = {
    gmailConnected: false,
    geminiConfigured: false,
    telegramConfigured: false,
    telegramVerified: false,
    notifyRulesExceptions: false,
    notifyAiExceptions: false,
    cashflowUseRealBalance: false,
    hasEmail: false
};

/**
 * Servicio para gestionar configuraciones de usuario
 */

/**
 * Guarda tokens de Gmail para un usuario
 */
export async function saveGmailTokens(userId, tokens) {
    try {
        // Preserve existing refresh_token when Google doesn't resend it
        let existingTokens = null;
        try {
            const { data, error } = await supabase
                .from('user_configs')
                .select('gmail_tokens')
                .eq('id', userId)
                .single();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            if (data?.gmail_tokens) {
                existingTokens = await decryptJSON(data.gmail_tokens, userId);
            }
        } catch (loadError) {
            logger.warn('⚠️ No se pudieron cargar tokens previos de Gmail:', loadError);
        }

        const mergedTokens = {
            ...(existingTokens ?? {}),
            ...(tokens ?? {})
        };

        const newRefreshToken = tokens?.refresh_token;
        const hasNewRefreshToken = typeof newRefreshToken === 'string'
            ? newRefreshToken.trim().length > 0
            : Boolean(newRefreshToken);

        if (!hasNewRefreshToken && existingTokens?.refresh_token) {
            mergedTokens.refresh_token = existingTokens.refresh_token;
        }

        const encrypted = await encryptJSON(mergedTokens, userId);

        const { error } = await supabase
            .from('user_configs')
            .update({

                gmail_tokens: encrypted,
                gmail_connected_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', userId);

        if (error) throw error;

        logger.info(`✅ Tokens de Gmail guardados para usuario ${userId}`);
    } catch (error) {
        logger.error('❌ Error guardando tokens de Gmail:', error);
        throw error;
    }
}

/**
 * Carga tokens de Gmail de un usuario
 */
export async function loadGmailTokens(userId) {
    try {
        const { data, error } = await supabase
            .from('user_configs')
            .select('gmail_tokens')
            .eq('id', userId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                // No existe registro
                return null;
            }
            throw error;
        }

        if (!data || !data.gmail_tokens) {
            return null;
        }

        const tokens = await decryptJSON(data.gmail_tokens, userId);
        logger.info(`✅ Tokens de Gmail cargados para usuario ${userId}`);
        return tokens;
    } catch (error) {
        logger.error('❌ Error cargando tokens de Gmail:', error);
        return null;
    }
}

/**
 * Obtiene el estado de los tokens de Gmail (expiración, validez)
 */
export async function getGmailTokenStatus(userId) {
    try {
        const tokens = await loadGmailTokens(userId);

        if (!tokens) {
            return {
                connected: false,
                hasRefreshToken: false,
                expiryDate: null,
                expiresIn: null,
                isExpired: true,
                requiresReauth: true
            };
        }

        const hasRefreshToken = Boolean(tokens.refresh_token);
        const expiryDate = tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null;
        const now = Date.now();
        const expiresIn = tokens.expiry_date ? Math.floor((tokens.expiry_date - now) / 1000) : null;
        const isExpired = tokens.expiry_date ? tokens.expiry_date <= now : true;

        return {
            connected: true,
            hasRefreshToken,
            expiryDate,
            expiresIn, // seconds until expiration
            isExpired,
            requiresReauth: !hasRefreshToken // Only require reauth if we can't refresh
        };
    } catch (error) {
        logger.error('❌ Error obteniendo estado de tokens de Gmail:', error);
        return {
            connected: false,
            hasRefreshToken: false,
            expiryDate: null,
            expiresIn: null,
            isExpired: true,
            requiresReauth: true
        };
    }
}

/**
 * Guarda Gemini API Key para un usuario
 */
export async function saveGeminiKey(userId, apiKey, email) {
    try {
        const encrypted = await encrypt(apiKey, userId);

        const { data: existing, error: existingError } = await supabase
            .from('user_configs')
            .select('email')
            .eq('id', userId)
            .single();

        if (existingError && existingError.code !== 'PGRST116') {
            throw existingError;
        }

        const normalizedEmail = typeof email === 'string' && email.trim() ? email.trim() : null;
        const resolvedEmail = normalizedEmail ?? existing?.email ?? null;
        if (!resolvedEmail) {
            const err = new Error('email requerido para crear configuración de usuario');
            err.code = 'EMAIL_REQUIRED';
            throw err;
        }

        const payload = {
            id: userId,
            gemini_api_key: encrypted,
            gemini_configured_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        if (resolvedEmail) payload.email = resolvedEmail;

        const { error } = await supabase
            .from('user_configs')
            .upsert(payload, {
                onConflict: 'id'
            });

        if (error) throw error;

        logger.info(`✅ Gemini API Key guardada para usuario ${userId}`);
    } catch (error) {
        logger.error('❌ Error guardando Gemini API Key:', error);
        throw error;
    }
}

/**
 * Carga Gemini API Key de un usuario
 */
export async function loadGeminiKey(userId) {
    try {
        const { data, error } = await supabase
            .from('user_configs')
            .select('gemini_api_key')
            .eq('id', userId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return null;
            }
            throw error;
        }

        if (!data || !data.gemini_api_key) {
            return null;
        }

        const apiKey = await decrypt(data.gemini_api_key, userId);
        logger.info(`✅ Gemini API Key cargada para usuario ${userId}`);
        return apiKey;
    } catch (error) {
        logger.error('❌ Error cargando Gemini API Key:', error);
        return null;
    }
}

/**
 * Guarda configuración de Telegram para un usuario
 */
export async function saveTelegramConfig(userId, botToken, chatId, notifyRulesExceptions, notifyAiExceptions, email = null) {
    try {
        // 1. Get existing config to support partial updates
        const { data: existing, error: existingError } = await supabase
            .from('user_configs')
            .select('email, telegram_bot_token, telegram_chat_id, telegram_verified_at, notify_rules_exceptions, notify_ai_exceptions')
            .eq('id', userId)
            .single();

        if (existingError && existingError.code !== 'PGRST116') {
            throw existingError;
        }

        const normalizedEmail = typeof email === 'string' && email.trim() ? email.trim() : null;
        const resolvedEmail = normalizedEmail ?? existing?.email ?? null;
        if (!resolvedEmail) {
            const err = new Error('email requerido para crear configuración de usuario');
            err.code = 'EMAIL_REQUIRED';
            throw err;
        }

        // 2. Determine values to save (new value OR existing value OR null)
        // If botToken is provided (string), encrypt it.
        // If botToken is explicitly null, set to null.
        // If botToken is undefined, keep existing.
        let encryptedToken = existing?.telegram_bot_token;
        if (botToken !== undefined) {
            encryptedToken = botToken ? await encrypt(botToken, userId) : null;
        }

        const finalChatId = chatId !== undefined ? chatId : existing?.telegram_chat_id;

        // Toggles: use new value if provided, else keep existing, default to false if nothing exists
        const finalNotifyRules = notifyRulesExceptions !== undefined ? notifyRulesExceptions : (existing?.notify_rules_exceptions ?? false);
        const finalNotifyAi = notifyAiExceptions !== undefined ? notifyAiExceptions : (existing?.notify_ai_exceptions ?? false);

        const shouldResetVerification = botToken !== undefined || chatId !== undefined;
        const finalTelegramVerifiedAt = shouldResetVerification ? null : (existing?.telegram_verified_at ?? null);

        const payload = {
            id: userId,
            telegram_bot_token: encryptedToken,
            telegram_chat_id: finalChatId,
            notify_rules_exceptions: finalNotifyRules,
            notify_ai_exceptions: finalNotifyAi,
            telegram_configured_at: new Date().toISOString(),
            telegram_verified_at: finalTelegramVerifiedAt,
            updated_at: new Date().toISOString()
        };

        if (resolvedEmail) payload.email = resolvedEmail;

        const { error } = await supabase
            .from('user_configs')
            .upsert(payload, {
                onConflict: 'id'
            });

        if (error) throw error;

        logger.info(`✅ Configuración de Telegram guardada para usuario ${userId} (Partial Update)`);
    } catch (error) {
        logger.error('❌ Error guardando configuración de Telegram:', error);
        throw error;
    }
}

/**
 * Guarda preferencia de flujo de caja (sincronizar con saldo real)
 */
export async function saveCashflowPreference(userId, cashflowUseRealBalance, email = null) {
    try {
        const { data: existing, error: existingError } = await supabase
            .from('user_configs')
            .select('email, cashflow_use_real_balance')
            .eq('id', userId)
            .single();

        if (existingError && existingError.code !== 'PGRST116') {
            throw existingError;
        }

        const normalizedEmail = typeof email === 'string' && email.trim() ? email.trim() : null;
        const resolvedEmail = normalizedEmail ?? existing?.email ?? null;
        if (!resolvedEmail) {
            const err = new Error('email requerido para crear configuración de usuario');
            err.code = 'EMAIL_REQUIRED';
            throw err;
        }

        const payload = {
            id: userId,
            cashflow_use_real_balance: !!cashflowUseRealBalance,
            updated_at: new Date().toISOString()
        };

        if (resolvedEmail) payload.email = resolvedEmail;

        const { error } = await supabase
            .from('user_configs')
            .upsert(payload, {
                onConflict: 'id'
            });

        if (error) throw error;

        logger.info(`✅ Preferencia CashFlow guardada para usuario ${userId}`);
    } catch (error) {
        logger.error('❌ Error guardando preferencia CashFlow:', error);
        throw error;
    }
}

/**
 * Carga configuración de Telegram de un usuario
 */
export async function loadTelegramConfig(userId) {
    try {
        const { data, error } = await supabase
            .from('user_configs')
            .select('telegram_bot_token, telegram_chat_id, notify_rules_exceptions, notify_ai_exceptions')
            .eq('id', userId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return null;
            }
            throw error;
        }

        if (!data || !data.telegram_bot_token) {
            return null;
        }

        return {
            botToken: await decrypt(data.telegram_bot_token, userId),
            chatId: data.telegram_chat_id,
            notifyRulesExceptions: data.notify_rules_exceptions,
            notifyAiExceptions: data.notify_ai_exceptions
        };
    } catch (error) {
        logger.error('❌ Error cargando configuración de Telegram:', error);
        return null;
    }
}

/**
 * Marca configuración de Telegram como verificada
 */
export async function markTelegramVerified(userId) {
    try {
        const { error } = await supabase
            .from('user_configs')
            .update({
                telegram_verified_at: new Date().toISOString()
            })
            .eq('id', userId);

        if (error) throw error;
        logger.info(`✅ Telegram verificado para usuario ${userId}`);
    } catch (error) {
        logger.error('❌ Error marcando Telegram como verificado:', error);
        throw error;
    }
}

/**
 * Obtiene el estado de configuración de un usuario
 */
export async function getUserConfigStatus(userId) {
    try {
        const { data, error } = await supabase
            .from('user_configs')
            .select('*')
            .eq('id', userId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return { ...DEFAULT_CONFIG_STATUS };
            }
            if (error.code === '42P01' || error.code === '42703') {
                logger.warn('⚠️ user_configs schema missing or outdated; returning defaults', error);
                return { ...DEFAULT_CONFIG_STATUS };
            }
            throw error;
        }

        const notifyRules = data?.notify_rules_exceptions ?? data?.notify_on_invoice ?? false;
        const notifyAi = data?.notify_ai_exceptions ?? data?.notify_on_agent ?? false;

        return {
            gmailConnected: !!data.gmail_connected_at,
            geminiConfigured: !!data.gemini_configured_at,
            telegramConfigured: !!data.telegram_configured_at,
            gmailConnectedAt: data.gmail_connected_at,
            geminiConfiguredAt: data.gemini_configured_at,
            telegramConfiguredAt: data.telegram_configured_at,
            telegramVerified: !!data.telegram_verified_at,
            telegramVerifiedAt: data.telegram_verified_at,
            notifyRulesExceptions: notifyRules,
            notifyAiExceptions: notifyAi,
            cashflowUseRealBalance: data?.cashflow_use_real_balance ?? false,
            hasEmail: !!data.email
        };
    } catch (error) {
        logger.error('❌ Error obteniendo estado de configuración:', error);
        return { ...DEFAULT_CONFIG_STATUS };
    }
}

/**
 * Elimina tokens de Gmail de un usuario
 */
export async function deleteGmailTokens(userId) {
    try {
        const { error } = await supabase
            .from('user_configs')
            .update({
                gmail_tokens: null,
                gmail_connected_at: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', userId);

        if (error) throw error;

        logger.info(`✅ Tokens de Gmail eliminados para usuario ${userId}`);
    } catch (error) {
        logger.error('❌ Error eliminando tokens de Gmail:', error);
        throw error;
    }
}

/**
 * Elimina configuración de Telegram de un usuario
 */
export async function deleteTelegramConfig(userId) {
    try {
        const { error } = await supabase
            .from('user_configs')
            .update({
                telegram_bot_token: null,
                telegram_chat_id: null,
                telegram_configured_at: null,
                telegram_verified_at: null,
                notify_rules_exceptions: false,
                notify_ai_exceptions: false,
                updated_at: new Date().toISOString()
            })
            .eq('id', userId);

        if (error) throw error;

        logger.info(`✅ Configuración de Telegram eliminada para usuario ${userId}`);
    } catch (error) {
        logger.error('❌ Error eliminando configuración de Telegram:', error);
        throw error;
    }
}

/**
 * Crea o actualiza el email del usuario en user_configs
 */
export async function ensureUserConfig(userId, email) {
    try {
        const { error } = await supabase
            .from('user_configs')
            .upsert({
                id: userId,
                email: email,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'id',
                ignoreDuplicates: false
            });

        if (error) throw error;

        logger.info(`✅ Configuración de usuario asegurada para ${userId}`);
    } catch (error) {
        logger.error('❌ Error asegurando configuración de usuario:', error);
        throw error;
    }
}
