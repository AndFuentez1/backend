import logger from '../utils/logger.js';
import { supabase } from './supabase.service.js';

// Diccionario de clasificación basado en keywords
// Basado en el workflow de n8n del usuario
const CATEGORY_KEYWORDS = {
    'Alimentación': [
        'zanahoria', 'papa', 'carne', 'leche', 'pan', 'arroz', 'frijol', 'huevo',
        'pollo', 'pescado', 'verdura', 'fruta', 'queso', 'yogurt', 'cereal',
        'pasta', 'aceite', 'sal', 'azúcar', 'harina', 'tomate', 'cebolla',
        'lechuga', 'manzana', 'banano', 'naranja', 'platano', 'yuca', 'arepa',
        'huevos', 'avena', 'mantequilla', 'cafe', 'chocolate en polvo'
    ],
    'Restaurantes': [
        'domicilios', 'rappi', 'uber eats', 'didi food', 'restaurante',
        'comida', 'almuerzo', 'cena', 'desayuno', 'pizza', 'hamburguesa',
        'sushi', 'comida rapida'
    ],
    'Mecato y bebidas': [
        'gaseosa', 'coca cola', 'pepsi', 'jugo', 'agua', 'cerveza', 'vino',
        'licor', 'snack', 'papas', 'galletas', 'chocolate', 'dulce', 'caramelo',
        'chicle', 'helado', 'postre'
    ],
    'Transporte': [
        'uber', 'taxi', 'bus', 'metro', 'transmilenio', 'pasaje', 'transporte',
        'cabify', 'beat', 'indriver'
    ],
    'Gasolina': [
        'gasolina', 'combustible', 'diesel', 'ecopetrol', 'terpel', 'esso',
        'mobil', 'shell', 'petrobras'
    ],
    'Farmacia y Salud': [
        'farmacia', 'drogueria', 'medicamento', 'medicina', 'pastilla',
        'jarabe', 'crema', 'ungüento', 'vitamina', 'suplemento', 'antibiotico',
        'analgesico', 'cruz verde', 'cafam', 'colsubsidio'
    ],
    'Cuidado personal y estética': [
        'shampoo', 'jabon', 'crema', 'desodorante', 'perfume', 'maquillaje',
        'cosmetico', 'peluqueria', 'barberia', 'salon', 'spa', 'manicure',
        'pedicure', 'cepillo', 'pasta dental', 'enjuague'
    ],
    'Aseo y limpieza': [
        'detergente', 'jabon', 'cloro', 'limpiador', 'desinfectante',
        'escoba', 'trapero', 'esponja', 'papel higienico', 'servilleta',
        'toalla', 'bolsa basura'
    ],
    'Ropa, calzado y accesorios': [
        'camisa', 'pantalon', 'zapatos', 'tenis', 'ropa', 'vestido',
        'falda', 'blusa', 'chaqueta', 'abrigo', 'gorra', 'sombrero',
        'bufanda', 'guantes', 'medias', 'calcetines', 'interior', 'pijama'
    ],
    'Utilería hogar y decoración': [
        'mueble', 'silla', 'mesa', 'cama', 'sofa', 'estante', 'lampara',
        'cortina', 'alfombra', 'cuadro', 'espejo', 'florero', 'planta',
        'decoracion', 'adorno'
    ],
    'Aplicativos, libros y gadgets': [
        'netflix', 'spotify', 'amazon', 'libro', 'revista', 'periodico',
        'suscripcion', 'app', 'aplicacion', 'software', 'licencia',
        'audifono', 'cable', 'cargador', 'mouse', 'teclado', 'usb'
    ],
    'Educación': [
        'colegio', 'universidad', 'curso', 'clase', 'matricula', 'pension',
        'libro', 'cuaderno', 'lapiz', 'esfero', 'marcador', 'borrador',
        'regla', 'compas', 'calculadora', 'mochila'
    ],
    'Gym': [
        'gimnasio', 'gym', 'fitness', 'entrenamiento', 'deporte',
        'pesas', 'yoga', 'pilates', 'spinning', 'crossfit'
    ],
    'Teléfono': [
        'claro', 'movistar', 'tigo', 'wom', 'recarga', 'plan', 'datos',
        'minutos', 'telefono', 'celular', 'movil'
    ],
    'Parqueadero': [
        'parqueadero', 'parking', 'estacionamiento', 'parqueo'
    ],
    'Moto': [
        'moto', 'motocicleta', 'repuesto', 'llanta', 'aceite motor',
        'filtro', 'bujia', 'cadena', 'freno'
    ],
    'Regalos': [
        'regalo', 'obsequio', 'presente', 'detalle', 'sorpresa'
    ],
    'Documentos y papelería': [
        'notaria', 'fotocopia', 'impresion', 'papel', 'sobre',
        'carpeta', 'archivo', 'documento', 'certificado', 'tramite'
    ],
    'Impuestos y multas': [
        'impuesto', 'multa', 'comparendo', 'predial', 'vehiculo',
        'transito', 'dian', 'secretaria hacienda'
    ],
};

// Mapeo opcional de códigos de producto -> categoría (alta precisión)
// TODO: Completar con los códigos reales de cada proveedor.
// Ejemplo basado en la factura de Éxito (alimentos).
const CATEGORY_CODES = {
    'Alimentación': [
        '3568953',
        '1098',
        '3668741',
        '737089',
        '1188',
        '1279',
        '1141',
        '3750923'
    ]
};

/**
 * Normaliza texto para comparación (quita tildes, espacios, minúsculas)
 */
function normalizeText(text) {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Quitar tildes
        .replace(/\s+/g, ' ')
        .trim();
}

function findCategoryByCode(code) {
    if (!code) { return null; }
    const normalized = code.toString().trim();
    for (const [category, codes] of Object.entries(CATEGORY_CODES)) {
        if (codes.includes(normalized)) {
            return category;
        }
    }
    return null;
}

/**
 * Busca una regla en la base de datos para un usuario específico
 */
async function findDbRule(userId, pattern, type) {
    if (!userId || !pattern) return null;
    try {
        const { data, error } = await supabase
            .from('classifier_rules')
            .select('category')
            .eq('user_id', userId)
            .eq('pattern', pattern)
            .eq('type', type)
            .maybeSingle();

        if (error) throw error;
        return data?.category || null;
    } catch (error) {
        logger.error(`❌ Error buscando regla DB (${type}):`, error);
        return null;
    }
}

/**
 * Clasifica un producto basándose en:
 * 1. Códigos hardcodeados (Alta prioridad)
 * 2. Memoria persistente (DB rules para el usuario)
 * 3. Keywords hardcodeadas
 */
export async function classifyProduct(product, userId = null) {
    const normalizedDescription = normalizeText(product.description || '');
    const productCode = product.code?.toString().trim();

    // 1. Prioridad: Códigos hardcodeados
    const staticCodeCategory = findCategoryByCode(productCode);
    if (staticCodeCategory) {
        return {
            category: staticCodeCategory,
            confidence: 100,
            matchedKeywords: [`static_code:${productCode}`],
            source: 'static_code'
        };
    }

    // 2. Prioridad: Reglas de la DB (Nueva Memoria)
    if (userId) {
        // Primero intentar por código en DB
        if (productCode) {
            const dbCodeCategory = await findDbRule(userId, productCode, 'code');
            if (dbCodeCategory) {
                return {
                    category: dbCodeCategory,
                    confidence: 100,
                    matchedKeywords: [`db_code:${productCode}`],
                    source: 'db_code'
                };
            }
        }

        // Luego intentar por keyword exacta en DB (buscando cada palabra corregida anteriormente)
        // O simplemente si la descripción coincide con un patrón aprendido
        const { data: dbKeywords } = await supabase
            .from('classifier_rules')
            .select('pattern, category')
            .eq('user_id', userId)
            .eq('type', 'keyword');

        if (dbKeywords) {
            for (const rule of dbKeywords) {
                if (normalizedDescription.includes(normalizeText(rule.pattern))) {
                    return {
                        category: rule.category,
                        confidence: 95,
                        matchedKeywords: [`db_keyword:${rule.pattern}`],
                        source: 'db_keyword'
                    };
                }
            }
        }
    }

    // 3. Prioridad: Keywords hardcodeadas (Las del código)
    let bestMatch = {
        category: 'Otros',
        confidence: 0,
        matchedKeywords: [],
        source: 'rules'
    };

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        const matches = keywords.filter(keyword =>
            normalizedDescription.includes(normalizeText(keyword))
        );

        if (matches.length > 0) {
            const confidence = Math.min(100, 70 + (matches.length * 10));
            if (confidence > bestMatch.confidence) {
                bestMatch = {
                    category,
                    confidence,
                    matchedKeywords: matches,
                    source: 'rules'
                };
            }
        }
    }

    return bestMatch;
}

/**
 * Aprende una nueva regla de clasificación
 */
export async function learnRule(userId, pattern, category, type = 'keyword') {
    if (!userId || !pattern || !category) return;
    try {
        const { error } = await supabase
            .from('classifier_rules')
            .upsert({
                user_id: userId,
                pattern: pattern,
                category: category,
                type: type,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,pattern,type' });

        if (error) throw error;
        logger.info(`🧠 Regla aprendida: ${pattern} -> ${category} (${type})`);
        return true;
    } catch (error) {
        logger.error('❌ Error guardando aprendizaje:', error);
        return false;
    }
}

/**
 * Clasifica múltiples productos y determina la categoría principal
 */
export async function classifyInvoice(products, userId = null) {
    try {
        // Clasificar cada producto (ahora es async por la DB)
        const classifications = [];
        for (const product of products) {
            const classification = await classifyProduct(product, userId);
            classifications.push({
                ...product,
                ...classification,
            });
        }

        // Agrupar por categoría y sumar totales
        const categoryTotals = {};
        classifications.forEach(item => {
            if (!categoryTotals[item.category]) {
                categoryTotals[item.category] = {
                    total: 0,
                    count: 0,
                    confidence: 0,
                };
            }
            categoryTotals[item.category].total += item.total;
            categoryTotals[item.category].count += 1;
            categoryTotals[item.category].confidence = Math.max(
                categoryTotals[item.category].confidence,
                item.confidence
            );
        });

        // Encontrar la categoría con mayor valor total
        let mainCategory = 'Otros';
        let maxTotal = 0;
        let mainConfidence = 0;

        for (const [category, data] of Object.entries(categoryTotals)) {
            if (data.total > maxTotal) {
                maxTotal = data.total;
                mainCategory = category;
                mainConfidence = data.confidence;
            }
        }

        // Determinar si necesita IA
        const needsAI = mainConfidence < 90 || mainCategory === 'Otros';

        logger.info(`🏷️  Clasificación: ${mainCategory} (confianza: ${mainConfidence}%)`);

        return {
            categoria: mainCategory,
            certeza: mainConfidence,
            necesita_ia: needsAI,
            productos_clasificados: classifications,
            razonamiento: needsAI
                ? 'Clasificación incierta, requiere revisión de IA'
                : `Clasificado como ${mainCategory} con alta confianza`,
        };
    } catch (error) {
        logger.error('❌ Error clasificando factura:', error);
        return {
            categoria: 'Otros',
            certeza: 0,
            necesita_ia: true,
            productos_clasificados: [],
            razonamiento: 'Error en clasificación automática',
        };
    }
}
