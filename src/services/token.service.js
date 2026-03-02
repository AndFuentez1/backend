import { loadGmailTokens, saveGmailTokens } from './userConfig.service.js';
import { oauth2Client } from '../config/gmail.config.js';
import logger from '../utils/logger.js';

/**
 * Servicio de gestión de tokens OAuth2 para Gmail (Multi-Usuario)
 * Ahora usa Supabase en lugar de archivos locales
 */

/**
 * Carga y configura tokens para un usuario específico
 * @param {string} userId - ID del usuario
 * @returns {Promise<boolean>} - true si los tokens son válidos
 */
export async function loadAndSetTokens(userId) {
    try {
        const tokens = await loadGmailTokens(userId);

        if (!tokens) {
            logger.warn(`⚠️ No hay tokens guardados para usuario ${userId}`);
            return false;
        }

        // Configurar tokens en oauth2Client
        oauth2Client.setCredentials(tokens);

        // Verificar si el token está expirado
        const isExpired = tokens.expiry_date && tokens.expiry_date <= Date.now();

        if (isExpired) {
            logger.info(`🔄 Token expirado para usuario ${userId}, refrescando...`);
            return await refreshTokens(userId);
        }

        logger.info(`✅ Tokens cargados y válidos para usuario ${userId}`);
        return true;
    } catch (error) {
        logger.error(`❌ Error cargando tokens para usuario ${userId}:`, error);
        return false;
    }
}

/**
 * Refresca los tokens de acceso usando el refresh token
 * @param {string} userId - ID del usuario
 * @returns {Promise<boolean>} - true si se refrescaron exitosamente
 */
export async function refreshTokens(userId) {
    try {
        logger.info(`🔄 Refrescando tokens para usuario ${userId}...`);

        // Obtener nuevos tokens
        const { credentials } = await oauth2Client.refreshAccessToken();

        // Guardar nuevos tokens
        await saveGmailTokens(userId, credentials);

        // Actualizar oauth2Client
        oauth2Client.setCredentials(credentials);

        logger.info(`✅ Tokens refrescados exitosamente para usuario ${userId}`);
        return true;
    } catch (error) {
        logger.error(`❌ Error refrescando tokens para usuario ${userId}:`, error);
        return false;
    }
}

/**
 * Verifica si hay tokens válidos para un usuario
 * @param {string} userId - ID del usuario
 * @returns {Promise<boolean>} - true si hay tokens válidos
 */
export async function hasValidTokens(userId) {
    try {
        const tokens = await loadGmailTokens(userId);

        if (!tokens) {
            return false;
        }

        // Verificar si el token está expirado
        const isExpired = tokens.expiry_date && tokens.expiry_date <= Date.now();

        if (isExpired) {
            // Intentar refrescar
            return await refreshTokens(userId);
        }

        return true;
    } catch (error) {
        logger.error(`❌ Error verificando tokens para usuario ${userId}:`, error);
        return false;
    }
}

/**
 * Obtiene el oauth2Client configurado para un usuario
 * @param {string} userId - ID del usuario
 * @returns {Promise<Object|null>} - oauth2Client configurado o null
 */
export async function getConfiguredOAuthClient(userId) {
    try {
        const isValid = await loadAndSetTokens(userId);

        if (!isValid) {
            logger.warn(`⚠️ No se pudo configurar OAuth client para usuario ${userId}`);
            return null;
        }

        return oauth2Client;
    } catch (error) {
        logger.error(`❌ Error obteniendo OAuth client para usuario ${userId}:`, error);
        return null;
    }
}
