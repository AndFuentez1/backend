import express from 'express';
import { initiateOAuth, handleOAuthCallback, checkAuthStatus } from '../controllers/auth.controller.ts';

const router = express.Router();

// Iniciar flujo OAuth
router.get('/google', initiateOAuth);

// Callback de Google
router.get('/google/callback', handleOAuthCallback);

// Verificar estado de autenticación
router.get('/status', checkAuthStatus);

export default router;
