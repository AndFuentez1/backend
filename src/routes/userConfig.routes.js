import express from 'express';
import supabase from '../config/supabase.config.js';
import { createRequireAuth } from '../middleware/requireAuth.js';
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

// Todas las rutas requieren sesión válida: el userId se toma del JWT, no del cliente
router.use(createRequireAuth((token) => supabase.auth.getUser(token)));

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
