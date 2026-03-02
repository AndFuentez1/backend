import TelegramBot from 'node-telegram-bot-api';
import { loadTelegramConfig } from './userConfig.service.js';
import logger from '../utils/logger.js';

/**
 * Envía un mensaje de Telegram a un usuario si tiene configurado el bot
 */
export async function sendTelegramMessage(userId, message) {
    try {
        const config = await loadTelegramConfig(userId);

        if (!config || !config.botToken || !config.chatId) {
            return false;
        }

        const bot = new TelegramBot(config.botToken);
        await bot.sendMessage(config.chatId, message, { parse_mode: 'Markdown' });
        
        logger.info(`📨 Telegram enviado a usuario ${userId}`);
        return true;
    } catch (error) {
        logger.error(`❌ Error enviando Telegram a usuario ${userId}:`, error.message);
        return false;
    }
}
