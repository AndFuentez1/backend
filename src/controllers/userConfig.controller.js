import {
    saveGeminiKey,
    saveTelegramConfig,
    saveCashflowPreference as saveCashflowPreferenceService,
    getUserConfigStatus,
    getGmailTokenStatus,
    deleteGmailTokens,
    deleteTelegramConfig,
    markTelegramVerified
} from '../services/userConfig.service.js';
import { sendTelegramMessage } from '../services/telegram.service.js';
import logger from '../utils/logger.js';

/**
 * Guarda Gemini API Key para un usuario
 */
export async function saveGeminiConfig(req, res) {
    try {
        const { userId, email, geminiApiKey } = req.body;

        if (!userId || !geminiApiKey) {
            return res.status(400).json({ error: 'userId y geminiApiKey requeridos' });
        }

        await saveGeminiKey(userId, geminiApiKey, email);

        res.json({
            success: true,
            message: 'Gemini API Key guardada correctamente'
        });
    } catch (error) {
        logger.error('❌ Error guardando Gemini API Key:', error);
        if (error?.code === 'EMAIL_REQUIRED') {
            return res.status(400).json({ error: 'email requerido para crear configuración de usuario' });
        }
        res.status(500).json({ error: 'Error guardando configuración' });
    }
}

/**
 * Guarda configuración de Telegram para un usuario
 */
export async function saveTelegramConfiguration(req, res) {
    try {
        const { userId, email, botToken, chatId, notifyRulesExceptions, notifyAiExceptions } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId requerido' });
        }

        await saveTelegramConfig(userId, botToken, chatId, notifyRulesExceptions, notifyAiExceptions, email);

        res.json({
            success: true,
            message: 'Configuración de Telegram guardada correctamente'
        });
    } catch (error) {
        logger.error('❌ Error guardando configuración de Telegram:', error);
        if (error?.code === 'EMAIL_REQUIRED') {
            return res.status(400).json({ error: 'email requerido para crear configuración de usuario' });
        }
        const message = error?.message ? `Error guardando configuración: ${error.message}` : 'Error guardando configuración';
        res.status(500).json({ error: message, details: error?.details || null });
    }
}

/**
 * Guarda preferencia del flujo de caja (toggle sincronizar saldo real)
 */
export async function saveCashflowPreference(req, res) {
    try {
        const { userId, email, cashflowUseRealBalance } = req.body;

        if (!userId || typeof cashflowUseRealBalance !== 'boolean') {
            return res.status(400).json({ error: 'userId y cashflowUseRealBalance requeridos' });
        }

        await saveCashflowPreferenceService(userId, cashflowUseRealBalance, email);

        res.json({
            success: true,
            message: 'Preferencia de flujo de caja guardada correctamente'
        });
    } catch (error) {
        logger.error('❌ Error guardando preferencia CashFlow:', error);
        if (error?.code === 'EMAIL_REQUIRED') {
            return res.status(400).json({ error: 'email requerido para crear configuración de usuario' });
        }
        res.status(500).json({ error: 'Error guardando configuración' });
    }
}

/**
 * Prueba la configuración de Telegram enviando un mensaje
 */
export async function testTelegramConfiguration(req, res) {
    try {
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ error: 'userId requerido' });
        }

        const ok = await sendTelegramMessage(
            userId,
            '✅ Telegram conectado correctamente. Este es un mensaje de prueba.'
        );

        if (!ok) {
            return res.status(400).json({ error: 'No se pudo enviar el mensaje de prueba' });
        }

        await markTelegramVerified(userId);

        res.json({
            success: true,
            message: 'Mensaje de prueba enviado'
        });
    } catch (error) {
        logger.error('❌ Error probando Telegram:', error);
        res.status(500).json({ error: 'Error enviando mensaje de prueba' });
    }
}

/**
 * Obtiene el estado de configuración de un usuario
 */
export async function getConfigStatus(req, res) {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'userId requerido' });
        }

        const status = await getUserConfigStatus(userId);

        res.json(status);
    } catch (error) {
        logger.error('❌ Error obteniendo estado de configuración:', error);
        res.status(500).json({ error: 'Error obteniendo estado' });
    }
}

/**
 * Obtiene el estado de los tokens de Gmail (expiración, validez)
 */
export async function getGmailStatus(req, res) {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'userId requerido' });
        }

        const status = await getGmailTokenStatus(userId);

        res.json(status);
    } catch (error) {
        logger.error('❌ Error obteniendo estado de Gmail:', error);
        res.status(500).json({ error: 'Error obteniendo estado de Gmail' });
    }
}


/**
 * Desconecta Gmail de un usuario
 */
export async function disconnectGmail(req, res) {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId requerido' });
        }

        await deleteGmailTokens(userId);

        res.json({
            success: true,
            message: 'Gmail desconectado correctamente'
        });
    } catch (error) {
        logger.error('❌ Error desconectando Gmail:', error);
        res.status(500).json({ error: 'Error desconectando Gmail' });
    }
}

/**
 * Desconecta Telegram de un usuario
 */
export async function disconnectTelegram(req, res) {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId requerido' });
        }

        await deleteTelegramConfig(userId);

        res.json({
            success: true,
            message: 'Telegram desconectado correctamente'
        });
    } catch (error) {
        logger.error('❌ Error desconectando Telegram:', error);
        res.status(500).json({ error: 'Error desconectando Telegram' });
    }
}
