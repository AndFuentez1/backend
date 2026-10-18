import express from 'express';
import supabase from '../config/supabase.config.js';
import { createRequireAuth } from '../middleware/requireAuth.js';
import { createOAuthLink, initiateOAuth, handleOAuthCallback, checkAuthStatus } from '../controllers/auth.controller.ts';

const router = express.Router();
const requireAuth = createRequireAuth((token: string) => supabase.auth.getUser(token));

// Crea un enlace OAuth firmado para el usuario autenticado (JWT)
router.post('/google/init', requireAuth, createOAuthLink);

// Iniciar flujo OAuth (navegación del popup; exige `state` firmado)
router.get('/google', initiateOAuth);

// Callback de Google
router.get('/google/callback', handleOAuthCallback);

// Verificar estado de autenticación (identidad tomada del JWT)
router.get('/status', requireAuth, checkAuthStatus);

export default router;
