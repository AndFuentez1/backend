import { promisify } from 'util';
import crypto from 'crypto';
import logger from '../utils/logger.js';

/**
 * Servicio de encriptación para datos sensibles
 * Usa AES-256-CBC con key derivada por usuario
 */

const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-change-in-production-32ch';
const scryptAsync = promisify(crypto.scrypt);

/**
 * Encripta un texto usando AES-256-CBC
 * @param {string} text - Texto a encriptar
 * @param {string} userId - ID del usuario (usado como salt)
 * @returns {Promise<string>} - Texto encriptado en formato "iv:encrypted"
 */
export async function encrypt(text, userId) {
    try {
        if (!text) return null;

        // Derivar key única por usuario de forma asíncrona
        const key = await scryptAsync(ENCRYPTION_KEY, userId, 32);

        // Generar IV aleatorio
        const iv = crypto.randomBytes(16);

        // Crear cipher
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

        // Encriptar
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        // Retornar IV + encrypted
        return `${iv.toString('hex')}:${encrypted}`;
    } catch (error) {
        logger.error('❌ Error encriptando:', error);
        throw new Error('Error en encriptación');
    }
}

/**
 * Desencripta un texto encriptado con encrypt()
 * @param {string} encryptedText - Texto encriptado en formato "iv:encrypted"
 * @param {string} userId - ID del usuario (usado como salt)
 * @returns {Promise<string>} - Texto desencriptado
 */
export async function decrypt(encryptedText, userId) {
    try {
        if (!encryptedText) return null;

        // Separar IV y encrypted
        const [ivHex, encrypted] = encryptedText.split(':');

        if (!ivHex || !encrypted) {
            throw new Error('Formato de texto encriptado inválido');
        }

        // Derivar key única por usuario de forma asíncrona
        const key = await scryptAsync(ENCRYPTION_KEY, userId, 32);

        // Convertir IV de hex a buffer
        const iv = Buffer.from(ivHex, 'hex');

        // Crear decipher
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

        // Desencriptar
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
