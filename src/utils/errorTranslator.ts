/**
 * Diccionario de traducción de errores técnicos comunes a español
 */
const ERROR_TRANSLATIONS = {
    // Errores de JavaScript / Node.js
    'require is not defined': 'El motor de ejecución no soporta "require" (error de módulos ESM).',
    'is not defined': 'no está definido.',
    'is not a function': 'no es una función.',
    'cannot read property': 'no se puede leer la propiedad',
    'of undefined': 'de un valor no definido',
    'Unexpected token': 'Caracter inesperado en el código o JSON',

    // Errores de Red / API
    'fetch failed': 'Falló la conexión con el servidor',
    'network error': 'Error de red',
    'timeout': 'Tiempo de espera agotado',
    'quotaExceeded': 'Se ha superado la cuota de uso de la API (Gmail/Google)',
    'invalid_grant': 'La sesión ha expirado o las credenciales no son válidas',

    // Errores de Base de Datos (Supabase)
    'duplicate key value': 'Ya existe un registro con estos datos (duplicado)',
    'PGRST116': 'No se encontró el registro solicitado',
    '42P01': 'La tabla solicitada no existe en la base de datos',
};

/**
 * Traduce un mensaje de error técnico a uno más amigable en español
 * @param {string|Error} error - El error original
 * @returns {string} Mensaje traducido
 */
export function translateErrorMessage(error: unknown) {
    if (!error) {
        return 'Error desconocido';
    }

    const message = typeof error === 'string' ? error : (error.message || String(error));

    // Buscar coincidencias exactas o parciales
    for (const [english, spanish] of Object.entries(ERROR_TRANSLATIONS)) {
        if (message.includes(english)) {
            // Si es una coincidencia parcial, podemos intentar mantener el contexto (ej: "X is not defined")
            if (english === 'is not defined' && message !== english) {
                return message.replace('is not defined', 'no está definido');
            }
            if (english === 'require is not defined') {
                return 'Error de arquitectura: Se intentó usar una función antigua (require) en un entorno moderno (ESM). Por favor, contacta a soporte.';
            }
            return spanish;
        }
    }

    return message;
}
