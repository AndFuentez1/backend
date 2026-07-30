import { GoogleGenerativeAI } from '@google/generative-ai';
import { loadGeminiKey } from './userConfig.service.js';
import logger from '../utils/logger.js';

// Lista de categorías válidas (mismo orden que en n8n)
const VALID_CATEGORIES = [
    'Alimentación',
    'Arriendo y mudanzas',
    'Aseo y limpieza',
    'Cuidado personal y estética',
    'Teléfono',
    'Restaurantes',
    'Mecato y bebidas',
    'Educación',
    'Gym',
    'Oficina y trabajo',
    'Salidas, hospedajes y ocio',
    'Aplicativos, libros y gadgets',
    'Ropa, calzado y accesorios',
    'Farmacia y Salud',
    'Salud y pensión',
    'Seguro de vida',
    'Seguro moto',
    'Civica',
    'Transporte',
    'Gasolina',
    'Parqueadero',
    'Moto',
    'Regalos',
    'Utilería hogar y decoración',
    'Utilería oficina',
    'Documentos y papelería',
    'Grandes activos',
    'Reparaciones',
    'Préstamos',
    'Impuestos y multas',
    'Ahorros',
];

/**
 * Genera el prompt para Gemini basado en el workflow de n8n
 */
function generatePrompt(invoiceData) {
    return `You are an expert in personal finance and expense classification.

Analyze the following purchase record and classify it into ONE category.

**Purchase Information:**
- Store: ${invoiceData.tienda}
- Subject: ${invoiceData.subject || 'N/A'}
- Date: ${invoiceData.fecha}
- Products: ${invoiceData.productNames}
- Total: $${invoiceData.total}

**Available Categories:**
${VALID_CATEGORIES.join(', ')}

**Instructions:**
1. Analyze the products, store name, and subject
2. Choose the MOST APPROPRIATE category from the list above
3. If there's not enough information, use "Otros"
4. Provide a brief reasoning for your choice (in Spanish)
5. Assign a confidence level from 1 to 100

**IMPORTANT:**
- You must maintain all original fields
- Return ONLY valid JSON
- The category MUST be one from the list above

**Response Format (JSON only):**
{
  "categoria": "Category name",
  "razonamiento": "Brief explanation in Spanish",
  "confidence": 85
}`;
}

/**
 * Clasifica una factura usando Gemini AI
 * @param {string} userId - ID del usuario
 * @param {object} invoiceData - Datos de la factura
 */
export async function classifyWithAI(userId, invoiceData) {
    try {
        logger.info(`🤖 Clasificando con Gemini AI para usuario ${userId}...`);

        // Cargar API key del usuario
        const apiKey = await loadGeminiKey(userId);

        if (!apiKey) {
            throw new Error('No se encontró Gemini API Key para este usuario');
        }

        // Inicializar modelo con la key del usuario
        const genAI = new GoogleGenerativeAI(apiKey);
        // Use standard model name since 'latest' tag was dropped in v1beta
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });

        const prompt = generatePrompt(invoiceData);

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Intentar extraer JSON de la respuesta
        let jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No se pudo extraer JSON de la respuesta de Gemini');
        }

        const classification = JSON.parse(jsonMatch[0]);

        // Validar que la categoría sea válida
        if (!VALID_CATEGORIES.includes(classification.categoria)) {
            logger.warn(`⚠️  Categoría inválida de IA: ${classification.categoria}, usando 'Otros'`);
            classification.categoria = 'Otros';
            classification.confidence = 50;
        }

        logger.info(`✅ IA clasificó como: ${classification.categoria} (${classification.confidence}%)`);

        return {
            categoria: classification.categoria,
            razonamiento: classification.razonamiento,
            certeza: classification.confidence,
            origen: 'Inteligencia Artificial',
        };
    } catch (error) {
        logger.error('❌ Error en clasificación con IA:', error);

        // Fallback: devolver clasificación manual
        return {
            categoria: 'Otros',
            razonamiento: 'Error en clasificación automática, requiere revisión manual',
            certeza: 0,
            origen: 'Manual (Fallo Técnico IA)',
        };
    }
}

/**
 * Re-clasifica una factura que ya fue clasificada localmente
 * @param {string} userId - ID del usuario
 * @param {object} invoiceData - Datos de la factura
 * @param {object} localClassification - Clasificación local previa
 */
export async function reclassifyWithAI(userId, invoiceData, localClassification) {
    try {
        const aiClassification = await classifyWithAI(userId, invoiceData);

        // Comparar con clasificación local
        if (aiClassification.categoria !== localClassification.categoria) {
            logger.info(`🔄 IA corrigió: ${localClassification.categoria} → ${aiClassification.categoria}`);
            aiClassification.origen = 'Inteligencia Artificial (Corrección)';
        }

        return aiClassification;
    } catch (error) {
        logger.error('❌ Error en re-clasificación:', error);
        // Mantener clasificación local en caso de error
        return localClassification;
    }
}
