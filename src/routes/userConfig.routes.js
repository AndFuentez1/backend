import express from 'express';
import {
    saveGeminiConfig,
    saveTelegramConfiguration,
    saveCashflowPreference,
    testTelegramConfiguration,
    getConfigStatus,
    getGmailStatus,
    disconnectGmail,
    disconnectTelegram
} from '../controllers/userConfig.controller.js';

const router = express.Router();

// Guardar Gemini API Key
router.post('/gemini', saveGeminiConfig);

// Guardar configuración de Telegram
router.post('/telegram', saveTelegramConfiguration);

// Guardar preferencia de flujo de caja
router.post('/cashflow', saveCashflowPreference);

// Probar configuración de Telegram
router.post('/telegram/test', testTelegramConfiguration);

// Desconectar Telegram
router.post('/telegram/disconnect', disconnectTelegram);

// Obtener estado de configuración
router.get('/status', getConfigStatus);

// Obtener estado de tokens de Gmail
router.get('/gmail/status', getGmailStatus);

// Desconectar Gmail
router.post('/gmail/disconnect', disconnectGmail);

export default router;
