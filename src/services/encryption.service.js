import { promisify } from 'util';
import crypto from 'crypto';
import logger from '../utils/logger.js';

/**
 * Servicio de encriptación para datos sensibles (tokens de Gmail/Telegram, API key de Gemini).
 *
 * - Formato actual (v2): AES-256-GCM autenticado → "v2:iv:authTag:ciphertext" (hex).
 * - Formato legado (v1): AES-256-CBC → "iv:ciphertext" (hex). Solo se descifra;
 *   al volver a guardar un valor se re-cifra en v2.
 * - La key se deriva por usuario con scrypt (userId como salt).
 */

const GCM_ALGORITHM = 'aes-256-gcm';
const LEGACY_ALGORITHM = 'aes-256-cbc';
const V2_PREFIX = 'v2';
const DEV_FALLBACK_KEY = 'default-key-change-in-production-32ch';
const scryptAsync = promisify(crypto.scrypt);

let weakKeyWarned = false;

function getMasterKey() {
    const key = process.env.ENCRYPTION_KEY;
    if (key && key.length >= 32) return key;

    // No se lanza error para no dejar ilegibles los datos ya cifrados con la key actual,
    // pero se avisa una vez: en producción debe configurarse una ENCRYPTION_KEY robusta.
    if (!weakKeyWarned) {
        weakKeyWarned = true;
        const log = process.env.NODE_ENV === 'production' ? logger.error : logger.warn;
        log.call(logger, key
            ? '⚠️ ENCRYPTION_KEY tiene menos de 32 caracteres'
            : '⚠️ ENCRYPTION_KEY no configurada: se usa la key por defecto (inseguro)');
    }
    return key || DEV_FALLBACK_KEY;
}

async function deriveKey(userId) {
    return scryptAsync(getMasterKey(), userId, 32);
}

/** Indica si un valor cifrado usa el formato legado (CBC) y conviene re-cifrarlo. */
export function isLegacyCiphertext(encryptedText) {
    return typeof encryptedText === 'string' && !encryptedText.startsWith(`${V2_PREFIX}:`);
}

/**
 * Encripta un texto usando AES-256-GCM
 * @param {string} text - Texto a encriptar
 * @param {string} userId - ID del usuario (usado como salt)
 * @returns {Promise<string>} - Texto encriptado en formato "v2:iv:tag:encrypted"
 */
export async function encrypt(text, userId) {
    try {
        if (!text) return null;

        const key = await deriveKey(userId);
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv(GCM_ALGORITHM, key, iv);

        const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();

        return `${V2_PREFIX}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
    } catch (error) {
        logger.error('❌ Error encriptando:', error);
        throw new Error('Error en encriptación');
    }
}

/**
 * Desencripta un texto encriptado con encrypt() (v2) o con la versión legada CBC (v1)
 * @param {string} encryptedText - Texto encriptado
 * @param {string} userId - ID del usuario (usado como salt)
 * @returns {Promise<string>} - Texto desencriptado
 */
export async function decrypt(encryptedText, userId) {
    try {
        if (!encryptedText) return null;

        const parts = encryptedText.split(':');
        const key = await deriveKey(userId);

        if (parts[0] === V2_PREFIX) {
            const [, ivHex, tagHex, dataHex] = parts;
            if (!ivHex || !tagHex || !dataHex) {
                throw new Error('Formato de texto encriptado inválido');
            }
            const decipher = crypto.createDecipheriv(GCM_ALGORITHM, key, Buffer.from(ivHex, 'hex'));
            decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
            return Buffer.concat([
                decipher.update(Buffer.from(dataHex, 'hex')),
                decipher.final()
            ]).toString('utf8');
        }

        const [ivHex, encrypted] = parts;
        if (parts.length !== 2 || !ivHex || !encrypted) {
            throw new Error('Formato de texto encriptado inválido');
        }

        const decipher = crypto.createDecipheriv(LEGACY_ALGORITHM, key, Buffer.from(ivHex, 'hex'));
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        logger.error('❌ Error desencriptando:', error);
        throw new Error('Error en desencriptación');
    }
}

/**
 * Encripta un objeto JSON
 * @param {object} obj - Objeto a encriptar
 * @param {string} userId - ID del usuario
 * @returns {Promise<string>} - JSON encriptado
 */
export async function encryptJSON(obj, userId) {
    const jsonString = JSON.stringify(obj);
    return await encrypt(jsonString, userId);
}

/**
 * Desencripta un JSON encriptado
 * @param {string} encryptedJSON - JSON encriptado
 * @param {string} userId - ID del usuario
 * @returns {Promise<object>} - Objeto desencriptado
 */
export async function decryptJSON(encryptedJSON, userId) {
    const jsonString = await decrypt(encryptedJSON, userId);
    return jsonString ? JSON.parse(jsonString) : null;
}
