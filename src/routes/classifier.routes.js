import express from 'express';
import { learnRule } from '../services/classifier.service.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * Aprende una nueva regla (Keyword o Código)
 */
router.post('/learn', async (req, res) => {
    try {
        const { userId, pattern, category, type } = req.body;

        if (!userId || !pattern || !category) {
            return res.status(400).json({ error: 'userId, pattern y category requeridos' });
        }

        const success = await learnRule(userId, pattern, category, type || 'keyword');

        if (success) {
            res.json({ success: true, message: 'Aprendizaje registrado exitosamente' });
        } else {
            res.status(500).json({ error: 'No se pudo registrar el aprendizaje' });
        }
    } catch (error) {
        logger.error('❌ Error en endpoint /learn:', error);
        res.status(500).json({ error: 'Error interno de servidor' });
    }
});

export default router;
