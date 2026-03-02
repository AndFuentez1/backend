import type { Request, Response } from 'express';
import { GmailService } from '../services/gmail.service.ts';
import { processInvoiceXML } from '../services/xml.service.js';
import { classifyInvoice } from '../services/classifier.service.js';
import { classifyWithAI } from '../services/gemini.service.js';
import { sendTelegramMessage } from '../services/telegram.service.js';
import { loadTelegramConfig, loadGmailTokens } from '../services/userConfig.service.js';
import { fetchMessageStatuses, markMessagesArchived, markMessagesDeleted, markMessagesRead, fetchRegisteredMessageIds, unmarkMessagesArchived } from '../services/gmailStatus.service.js';
import {
    checkDuplicate,
    insertPendingInvoice,
    deletePendingByMessageId,
    getPendingInvoices,
    getCategoryId,
    getPaymentMethodId
} from '../services/supabase.service.js';
import logger from '../utils/logger.js';
import { translateErrorMessage } from '../utils/errorTranslator.ts';

const QUOTA_REASONS = new Set([
    'quotaExceeded',
    'dailyLimitExceeded',
    'userRateLimitExceeded',
    'rateLimitExceeded',
    'backendError',
]);
const AUTH_REASONS = new Set([
    'invalidCredentials',
    'authError',
    'invalid_grant',
    'insufficientPermissions',
    'accessNotConfigured',
]);

const extractGmailError = (error: unknown) => {
    const status = (error as any)?.code || (error as any)?.response?.status;
    const reason = (error as any)?.response?.data?.error?.errors?.[0]?.reason;
    const message = (error as Record<string, any>)?.response?.data?.error?.message || (error as Record<string, any>)?.message;
    const retryAfter = (error as any)?.response?.headers?.['retry-after'];

    // Auth token errors (like 'invalid_grant') come as string in data.error instead of an array of errors
    const oauthError = typeof (error as Record<string, any>)?.response?.data?.error === 'string' ? (error as Record<string, any>).response.data.error : null;

    return { status, reason: (reason || oauthError) as string, message: message as string, retryAfter: retryAfter as string };
};

const isQuotaError = (error: unknown) => {
    const { status, reason } = extractGmailError(error);
    return status === 429 || (reason && QUOTA_REASONS.has(reason));
};

const isAuthError = (error: unknown) => {
    const { status, reason } = extractGmailError(error);
    return status === 401 || (reason && AUTH_REASONS.has(reason));
};

const isAccessNotConfigured = (error: unknown) => {
    const { reason } = extractGmailError(error);
    return reason === 'accessNotConfigured';
};

export type ClassifiedProduct = {
    description: string;
    quantity: number;
    price: number;
    total: number;
    totalExclTax?: number;
    taxAmount?: number;
    code?: string | null;
    category?: string;
    confidence?: number;
    source?: string;
};

const formatStoreLabel = (store: string) => {
    if (!store) { return 'Factura'; }
    return store.toString().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
};

const formatCategoryLabel = (category: string) => {
    if (!category) {
        return 'Otros';
    }
    return category.toString().trim();
};

const buildGroupDescription = (store: string, category: string, products: ClassifiedProduct[]) => {
    const storeLabel = formatStoreLabel(store);
    const categoryLabel = formatCategoryLabel(category);

    if (!products || products.length === 0) {
        const prefix = storeLabel ? `${storeLabel} ${categoryLabel}` : categoryLabel;
        return prefix.trim();
    }

    const details = products
        .map(p => `${p.description.substring(0, 20).trim()} x${p.quantity} $${p.total.toLocaleString()}`)
        .join(', ');

    // Format: "Product details - Store Category" for better category visualization
    const suffix = storeLabel ? `${storeLabel} ${categoryLabel}` : categoryLabel;
    return `${details} - ${suffix}`.trim().substring(0, 500);
};

const groupProductsByCategory = (store: string, products: ClassifiedProduct[]) => {
    const groups = new Map<string, { category: string; amount: number; products: ClassifiedProduct[] }>();
    products.forEach(product => {
        const category = product.category || 'Otros';
        if (!groups.has(category)) {
            groups.set(category, { category, amount: 0, products: [] });
        }
        const group = groups.get(category)!;
        group.amount += Number(product.total || 0);
        group.products.push(product);
    });

    return Array.from(groups.values()).map(group => ({
        category: group.category,
        amount: Number(group.amount.toFixed(2)),
        description: buildGroupDescription(store, group.category, group.products),
    }));
};

const buildInvoiceGroups = (
    store: string,
    products: ClassifiedProduct[],
    resolvedCategory: string | undefined,
    invoiceTotal: number
) => {
    const targetTotal = Number(invoiceTotal || 0);

    // 1. Agrupar por categoría
    const groups = groupProductsByCategory(store, products)
        .filter(group => Number(group.amount) > 0);

    const totalFromGroups = groups.reduce((sum, g) => sum + g.amount, 0);

    // 2. Si hay productos clasificados pero la suma no coincide con el total de la factura (DIAN)
    if (groups.length > 0 && targetTotal > 0 && Math.abs(totalFromGroups - targetTotal) > 0.01) {
        const diff = targetTotal - totalFromGroups;

        // Intentar agregar la diferencia al grupo "Otros"
        const otrosGroup = groups.find(g => g.category === 'Otros');
        if (otrosGroup) {
            otrosGroup.amount = Number((otrosGroup.amount + diff).toFixed(2));
        } else {
            // Si no hay Otros, agregarlo a la primera categoría o crear Otros
            groups.push({
                category: 'Otros',
                amount: Number(diff.toFixed(2)),
                description: buildGroupDescription(store, 'Otros', []),
            });
        }
    }

    if (groups.length > 0) {
        return groups;
    }

    // 3. Fallback si no hay productos clasificados
    const productsTotal = products.reduce((sum, product) => sum + Number(product.total || 0), 0);
    const fallbackAmount = targetTotal || productsTotal;

    if (fallbackAmount > 0) {
        return [{
            category: resolvedCategory || 'Otros',
            amount: Number(fallbackAmount.toFixed(2)),
            description: buildGroupDescription(store, resolvedCategory || 'Otros', products),
        }];
    }

    logger.warn(`⚠️ Factura sin totales válidos para ${store}`);
    return [];
};

export const overrideProductsCategory = (products: ClassifiedProduct[], category: string, confidence?: number) =>
    products.map(product => {
        // Preserve granular categorization from rules, only override unknowns or very low confidence
        if (!product.category || product.category === 'Otros' || (product.confidence || 0) < 50) {
            return {
                ...product,
                category,
                confidence: Math.max(confidence || 0, product.confidence || 0),
                source: 'ai'
            };
        }
        return product; // Keep the original rule-based categorization
    });

const shouldNotifyTelegram = (telegramConfig: unknown, stepOfFailure: 'rules' | 'ai' | null) => {
    const config = telegramConfig as Record<string, unknown>;
    if (!config?.botToken || !config?.chatId || !stepOfFailure) {
        return false;
    }
    if (stepOfFailure === 'rules') {
        return Boolean(config.notifyRulesExceptions);
    }
    if (stepOfFailure === 'ai') {
        return Boolean(config.notifyAiExceptions);
    }
    return false;
};

/**
 * Procesa correos de Gmail manualmente
 */
export async function processGmailInvoices(req: Request, res: Response) {
    try {
        logger.info('🚀 Iniciando procesamiento de facturas...');

        const { userId } = req.query as { userId: string };
        if (!userId) {
            return res.status(400).json({ error: 'userId requerido en query params' });
        }

        // Cargar configuración de Telegram una vez
        const telegramConfig = await loadTelegramConfig(userId);

        // Cargar tokens de Gmail
        const tokens = await loadGmailTokens(userId);
        if (!tokens) {
            return res.status(401).json({ error: 'Usuario no tiene Gmail conectado' });
        }

        // Configurar servicio con los tokens del usuario
        const gmailService = new GmailService();
        gmailService.setTokens(tokens, userId);

        // 1. Obtener correos con facturas
        const emails = await gmailService.fetchInvoiceEmails(userId);

        if (emails.length === 0) {
            return res.json({
                message: 'No se encontraron nuevas facturas',
                processed: 0,
            });
        }

        const results: unknown[] = [];
        const approvedMessageIds: string[] = [];
        let processedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        // 2. Procesar cada factura
        for (const email of emails as { messageId: string, xmlContent: string }[]) {
            try {
                // Verificar duplicados
                const isDuplicate = await checkDuplicate(email.messageId, userId);
                if (isDuplicate) {
                    logger.info(`⏭️  Saltando factura duplicada: ${email.messageId}`);
                    skippedCount++;
                    approvedMessageIds.push(email.messageId);
                    results.push({ messageId: email.messageId, status: 'duplicate' });
                    continue;
                }

                // 3. Parsear XML
                const invoiceData = await processInvoiceXML(email.xmlContent);

                // 4. Clasificar localmente (Paso 1) - AHORA ASYNC por Reglas en DB
                const localClassification = await classifyInvoice(invoiceData.productos, userId);

                let finalClassification = localClassification;
                let stepOfFailure: 'rules' | 'ai' | null = null;

                // Evaluar si Paso 1 falló (Reglas -> Otros)
                if (localClassification.categoria === 'Otros' && !localClassification.necesita_ia) {
                    stepOfFailure = 'rules';
                }

                // 5. Si necesita IA, re-clasificar (Paso 2)
                if (localClassification.necesita_ia) {
                    try {
                        logger.info('🤖 Clasificación local incierta, usando IA...');
                        const aiClassification = await classifyWithAI(userId, {
                            ...invoiceData,
                            productNames: invoiceData.productNames,
                        });
                        finalClassification = {
                            ...localClassification,
                            ...aiClassification,
                        };

                        // Si después de IA sigue siendo Otros
                        if (finalClassification.categoria === 'Otros') {
                            stepOfFailure = 'ai';
                        }
                    } catch (err: unknown) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        logger.warn(`⚠️ Falla en IA (continuando con clasificación manual): ${errMsg}`);
                        // Falló IA, nos quedamos con "Otros" de local
                        stepOfFailure = 'ai';
                    }
                } else if (finalClassification.categoria === 'Otros') {
                    stepOfFailure = 'rules';
                }

                // 6. Preparar productos clasificados (aplicar override si la IA resolvió categoría)
                const baseProducts = (localClassification.productos_clasificados || []) as ClassifiedProduct[];
                const resolvedCategory = finalClassification.categoria;
                const resolvedProducts = (localClassification.necesita_ia && resolvedCategory && resolvedCategory !== 'Otros')
                    ? overrideProductsCategory(baseProducts, resolvedCategory, finalClassification.certeza)
                    : baseProducts;

                const groups = buildInvoiceGroups(
                    invoiceData.tienda,
                    resolvedProducts,
                    resolvedCategory,
                    invoiceData.total
                );

                const resolvedPaymentMethodId = invoiceData.paymentMethod
                    ? await getPaymentMethodId(invoiceData.paymentMethod, userId)
                    : null;

                const shouldNotify = shouldNotifyTelegram(telegramConfig, stepOfFailure);
                if (shouldNotify) {
                    let msg = "";
                    if (stepOfFailure === 'rules') {
                        msg = `⚠️ *Revisión Manual (Reglas)*\n\nNo se pudo clasificar por reglas:\n🛒 ${invoiceData.tienda}\n💰 $${invoiceData.total.toLocaleString()}\n\n_Requiere aprobación manual._`;
                    } else if (stepOfFailure === 'ai') {
                        msg = `🤖 *Revisión Manual (IA)*\n\nAgente AI no pudo clasificar o falló:\n🛒 ${invoiceData.tienda}\n💰 $${invoiceData.total.toLocaleString()}\n\n_Requiere aprobación manual._`;
                    }
                    if (msg) {
                        await sendTelegramMessage(userId, msg);
                    }
                }

                const pendingRows: unknown[] = [];
                if (!shouldNotify) {
                    const source = 'ai';
                    for (const group of groups) {
                        // 7. Resolver category_id (Match entre texto de categoría y ID de DB)
                        const categoryId = await getCategoryId(group.category, userId);

                        // Si no hay categoría (ni siquiera el fallback), advertir pero usar null
                        // (o dejar que la DB falle si es NOT NULL, siguiendo el plan de asegurar el match primero)
                        if (!categoryId) {
                            logger.warn(`⚠️  No se pudo resolver category_id para: ${group.category}`);
                        }

                        const pendingInvoice = {
                            user_id: userId,
                            message_id: email.messageId,
                            arrival_date: invoiceData.fecha,
                            date: invoiceData.fecha,
                            description: group.description,
                            category_id: categoryId,
                            amount: group.amount,
                            status: 'pending',
                            payment_method_id: resolvedPaymentMethodId,
                            type: 'expense',
                            source
                        };

                        const inserted = await insertPendingInvoice(pendingInvoice);
                        pendingRows.push({
                            ...inserted,
                            category: group.category,
                            payment_method_id: resolvedPaymentMethodId
                        });
                    }
                }

                // 8. Marcar como procesado en Gmail
                await gmailService.markAsProcessed(userId, email.messageId);

                processedCount++;
                approvedMessageIds.push(email.messageId);
                results.push({
                    messageId: email.messageId,
                    status: shouldNotify ? 'telegram' : 'pending',
                    groups: pendingRows,
                    products: resolvedProducts
                });

            } catch (innerError: unknown) {
                logger.error(`❌ Error procesando email ${email.messageId}:`, innerError);
                errorCount++;
                const errorMessage = innerError instanceof Error ? innerError.message : 'Error procesando factura';
                results.push({
                    messageId: email.messageId,
                    status: 'error',
                    error: errorMessage
                });
            }
        }

        // Nota: no se archivan automaticamente. Solo se archivan si el usuario lo decide.

        // Respuesta final
        res.json({
            message: 'Procesamiento completado',
            total: emails.length,
            processed: processedCount,
            skipped: skippedCount,
            errors: errorCount,
            results,
        });
    } catch (error: unknown) {
        logger.error('❌ Error en procesamiento:', error);
        const errMessage = error instanceof Error ? error.message : 'Error desconocido';
        res.status(500).json({
            error: 'Error procesando facturas',
            details: errMessage,
        });
    }
}

/**
 * Webhook para Gmail Pub/Sub (futuro)
 */
export async function handleGmailWebhook(req: Request, res: Response) {
    try {
        logger.info('📬 Webhook recibido de Gmail');

        // Decodificar mensaje de Pub/Sub
        const message = req.body.message;
        if (!message || !message.data) {
            return res.status(400).json({ error: 'Mensaje inválido' });
        }

        const data = Buffer.from(message.data, 'base64').toString();
        logger.info('📨 Datos del webhook:', data);

        // TODO: Implementar procesamiento automático
        // Por ahora, solo confirmar recepción
        res.status(200).json({ message: 'Webhook recibido' });
    } catch (error: unknown) {
        logger.error('❌ Error en webhook:', error);
        res.status(500).json({ error: 'Error procesando webhook' });
    }
}

/**
 * Lista facturas pendientes
 */
export async function listPendingInvoices(req: Request, res: Response) {
    try {
        const { userId } = req.query as { userId: string };
        if (!userId) {
            return res.status(400).json({ error: 'userId requerido en query params' });
        }

        const invoices = await getPendingInvoices(userId);

        res.json({
            count: invoices.length,
            invoices,
        });
    } catch (error: unknown) {
        logger.error('❌ Error listando facturas:', error);
        res.status(500).json({ error: 'Error obteniendo facturas' });
    }
}

/**
 * Busca facturas en el historial de Gmail
 */
export async function searchGmailHistory(req: Request, res: Response) {
    const { userId } = req.query as { userId: string };
    try {
        const { markRead } = req.query as Record<string, unknown>;
        const { days, maxResults } = req.query as Record<string, unknown>;

        if (!userId) {
            return res.status(400).json({ error: 'userId requerido' });
        }

        const parsedDays = days ? parseInt(days as string, 10) : undefined;
        const validDays = parsedDays && parsedDays > 0 ? Math.min(parsedDays, 365) : undefined;

        const limit = maxResults ? parseInt(maxResults as string, 10) : undefined;

        const tokens = await loadGmailTokens(userId);
        if (!tokens) {
            return res.status(401).json({
                error: 'Gmail no conectado',
                code: 'TOKEN_MISSING',
                requiresReauth: true
            });
        }

        // Validate refresh token exists
        if (!tokens.refresh_token) {
            return res.status(401).json({
                error: 'Gmail session expired',
                code: 'TOKEN_EXPIRED',
                requiresReauth: true
            });
        }

        const gmailService = new GmailService();
        gmailService.setTokens(tokens, userId);
        const results = await gmailService.searchHistoricalMessages(validDays, limit);
        const messageIds = results.map(r => r.id);
        const statusMap = await fetchMessageStatuses(userId, messageIds);
        await fetchRegisteredMessageIds(userId, messageIds);

        let enriched = results.map(r => ({
            ...r,
            status: statusMap[r.id] ?? 'unread'
        }));

        enriched = enriched.filter(r => r.status !== 'deleted');

        const shouldMarkRead = markRead === '1' || markRead === 'true';
        if (shouldMarkRead && messageIds.length > 0) {
            await markMessagesRead(userId, messageIds);
            enriched = enriched.map(r => ({
                ...r,
                status: r.status === 'archived' ? 'archived' : 'read'
            }));
        }

        res.json({
            count: enriched.length,
            results: enriched
        });
    } catch (error: unknown) {
        const details = extractGmailError(error);
        if (isQuotaError(error)) {
            logger.warn('⚠️ Límite Gmail API alcanzado:', details);
            return res.status(429).json({
                error: 'Límite de Gmail API alcanzado. Intenta más tarde.',
                details: details.message,
                reason: details.reason,
                retryAfter: details.retryAfter
            });
        }
        if (isAuthError(error)) {
            logger.warn('⚠️ Error de autenticación Gmail:', details);
            const baseMessage = isAccessNotConfigured(error)
                ? 'Gmail API no está habilitada para el proyecto. Revisa la configuración en Google Cloud.'
                : 'La sesión de Gmail expiró o los permisos fueron revocados. Reconecta Gmail.';
            return res.status(401).json({
                error: baseMessage,
                code: 'TOKEN_EXPIRED',
                requiresReauth: true,
                details: details.message,
                reason: details.reason
            });
        }
        const errorDetails = translateErrorMessage(details.message || (error instanceof Error ? error.message : 'Error desconocido'));
        logger.error(`❌ Error buscando en historial para user ${userId}:`, {
            message: errorDetails,
            stack: error instanceof Error ? error.stack : 'N/A',
            code: (error as { code?: string })?.code
        });

        res.status(500).json({
            error: 'Error en búsqueda de historial',
            details: errorDetails,
            message: 'La búsqueda de historial falló. Por favor intenta de nuevo o reconecta tu cuenta si el problema persiste.'
        });
    }
}

/**
 * Importa un lote específico de mensajes de Gmail por ID
 */
export async function importGmailBatch(req: Request, res: Response) {
    try {
        const { userId, messageIds } = req.body;
        if (!userId || !messageIds || !Array.isArray(messageIds)) {
            return res.status(400).json({ error: 'userId y messageIds (array) requeridos' });
        }

        const telegramConfig = await loadTelegramConfig(userId);
        const tokens = await loadGmailTokens(userId);
        if (!tokens) {
            return res.status(401).json({
                error: 'Gmail no conectado',
                code: 'TOKEN_MISSING',
                requiresReauth: true
            });
        }

        // Validate refresh token exists
        if (!tokens.refresh_token) {
            return res.status(401).json({
                error: 'Gmail session expired',
                code: 'TOKEN_EXPIRED',
                requiresReauth: true
            });
        }

        const gmailService = new GmailService();
        gmailService.setTokens(tokens, userId);
        const emails = await gmailService.fetchSpecificMessages(messageIds);

        if (emails.length === 0) {
            return res.json({ message: 'No se encontraron facturas procesables en la selección', processed: 0 });
        }

        const results: unknown[] = [];
        const approvedMessageIds: string[] = [];
        let processedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (const email of emails as { messageId: string, xmlContent: string }[]) {
            try {
                const isDuplicate = await checkDuplicate(email.messageId, userId);
                if (isDuplicate) {
                    skippedCount++;
                    approvedMessageIds.push(email.messageId);
                    results.push({ messageId: email.messageId, status: 'duplicate' });
                    continue;
                }

                const invoiceData = await processInvoiceXML(email.xmlContent);
                // 4. Clasificar localmente (Paso 1) - AHORA ASYNC
                const localClassification = await classifyInvoice(invoiceData.productos, userId);
                let finalClassification = localClassification;
                let stepOfFailure: 'rules' | 'ai' | null = null;

                if (localClassification.categoria === 'Otros' && !localClassification.necesita_ia) {
                    stepOfFailure = 'rules';
                }

                if (localClassification.necesita_ia) {
                    try {
                        const aiClassification = await classifyWithAI(userId, {
                            ...invoiceData,
                            productNames: invoiceData.productNames,
                        });
                        finalClassification = { ...localClassification, ...aiClassification };
                        if (finalClassification.categoria === 'Otros') {
                            stepOfFailure = 'ai';
                        }
                    } catch (_err: unknown) {
                        stepOfFailure = 'ai';
                    }
                } else if (finalClassification.categoria === 'Otros') {
                    stepOfFailure = 'rules';
                }

                const baseProducts = (localClassification.productos_clasificados || []) as ClassifiedProduct[];
                const resolvedCategory = finalClassification.categoria;
                const resolvedProducts = (localClassification.necesita_ia && resolvedCategory && resolvedCategory !== 'Otros')
                    ? overrideProductsCategory(baseProducts, resolvedCategory, finalClassification.certeza)
                    : baseProducts;

                const groups = buildInvoiceGroups(
                    invoiceData.tienda,
                    resolvedProducts,
                    resolvedCategory,
                    invoiceData.total
                );

                const resolvedPaymentMethodId = invoiceData.paymentMethod
                    ? await getPaymentMethodId(invoiceData.paymentMethod, userId)
                    : null;

                const shouldNotify = shouldNotifyTelegram(telegramConfig, stepOfFailure);
                if (shouldNotify) {
                    let msg = "";
                    if (stepOfFailure === 'rules') {
                        msg = `⚠️ *Revisión Manual (Reglas - Import)*\n\nNo se pudo clasificar:\n🛒 ${invoiceData.tienda}\n💰 $${invoiceData.total.toLocaleString()}`;
                    } else if (stepOfFailure === 'ai') {
                        msg = `🤖 *Revisión Manual (IA - Import)*\n\nFallo en clasificación:\n🛒 ${invoiceData.tienda}\n💰 $${invoiceData.total.toLocaleString()}`;
                    }
                    if (msg) {
                        await sendTelegramMessage(userId, msg);
                    }
                }

                const pendingRows: unknown[] = [];
                const reviewGroups: unknown[] = [];
                const source = stepOfFailure ? 'ai' : 'gmail';
                for (const group of groups) {
                    // Resolver category_id (Match entre texto de categoría y ID de DB)
                    const categoryId = await getCategoryId(group.category, userId);

                    if (!categoryId) {
                        logger.warn(`⚠️  No se pudo resolver category_id para: ${group.category} (Lote)`);
                    }

                    reviewGroups.push({
                        category: group.category,
                        category_id: categoryId,
                        amount: group.amount,
                        description: group.description,
                        arrival_date: invoiceData.fecha,
                        payment_method_id: resolvedPaymentMethodId
                    });

                    if (!shouldNotify) {
                        // Limpiar pending anterior del mismo mensaje (re-import limpio)
                        await deletePendingByMessageId(email.messageId, userId);

                        const pendingInvoice = {
                            user_id: userId,
                            message_id: email.messageId,
                            arrival_date: invoiceData.fecha,
                            date: invoiceData.fecha,
                            description: group.description,
                            category_id: categoryId,
                            amount: group.amount,
                            status: 'pending',
                            payment_method_id: resolvedPaymentMethodId,
                            type: 'expense',
                            source
                        };
                        const inserted = await insertPendingInvoice(pendingInvoice);
                        pendingRows.push({
                            ...inserted,
                            category: group.category,
                            category_id: categoryId,
                            payment_method_id: resolvedPaymentMethodId
                        });
                    }
                }

                const responseGroups = pendingRows.length > 0 ? pendingRows : reviewGroups;

                let finalStatus = shouldNotify ? 'telegram' : 'pending';
                if (pendingRows.length === 0 && reviewGroups.length === 0) {
                    finalStatus = 'manual_review';
                }

                await gmailService.markAsProcessed(userId, email.messageId);

                processedCount++;
                approvedMessageIds.push(email.messageId);
                results.push({
                    messageId: email.messageId,
                    status: finalStatus,
                    stepOfFailure,
                    store: invoiceData.tienda,
                    total: invoiceData.total,
                    date: invoiceData.fecha,
                    groups: responseGroups,
                    products: resolvedProducts
                });
            } catch (innerError: unknown) {
                try {
                    const errMsg = innerError instanceof Error ? innerError.message : String(innerError);
                    console.error(`❌ Error auto-saving refreshed Gmail tokens for user ${userId}:`, errMsg);
                } catch (err: unknown) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    console.error(`❌ Error auto-saving refreshed Gmail tokens for user ${userId}:`, errMsg);
                }
                errorCount++;
                const errorMessage = innerError instanceof Error ? innerError.message : 'Error importando factura';
                results.push({
                    messageId: email.messageId,
                    status: 'error',
                    error: errorMessage
                });
            }
        }

        // Nota: no se archivan automaticamente. Solo se archivan si el usuario lo decide.

        res.json({
            message: 'Importación completada',
            total: messageIds.length,
            found: emails.length,
            processed: processedCount,
            skipped: skippedCount,
            errors: errorCount,
            results
        });
    } catch (error: unknown) {
        const details = extractGmailError(error);
        if (isQuotaError(error)) {
            logger.warn('⚠️ Límite Gmail API alcanzado (lote):', details);
            return res.status(429).json({
                error: 'Límite de Gmail API alcanzado. Intenta más tarde.',
                details: details.message,
                reason: details.reason,
                retryAfter: details.retryAfter
            });
        }
        if (isAuthError(error)) {
            logger.warn('⚠️ Error de autenticación Gmail (lote):', details);
            const baseMessage = isAccessNotConfigured(error)
                ? 'Gmail API no está habilitada para el proyecto. Revisa la configuración en Google Cloud.'
                : 'La sesión de Gmail expiró o los permisos fueron revocados. Reconecta Gmail.';
            return res.status(401).json({
                error: baseMessage,
                code: 'TOKEN_EXPIRED',
                requiresReauth: true,
                details: details.message,
                reason: details.reason
            });
        }
        logger.error('❌ Error en importación por lote:', error);
        res.status(500).json({ error: 'Error procesando lote', details: details.message || (error as Error).message });
    }
}

/**
 * Marca mensajes de Gmail como archivados (revisados)
 */
export async function archiveGmailMessages(req: Request, res: Response) {
    try {
        const { userId, messageIds } = req.body;
        if (!userId || !messageIds || !Array.isArray(messageIds)) {
            return res.status(400).json({ error: 'userId y messageIds (array) requeridos' });
        }

        await markMessagesArchived(userId, messageIds);
        res.json({ success: true });
    } catch (error: any) {
        logger.error('❌ Error archivando mensajes Gmail:', error);
        res.status(500).json({ error: 'Error archivando mensajes', details: error.message });
    }
}

/**
 * Elimina mensajes de Gmail del historial (ocultar)
 */
export async function deleteGmailMessages(req: Request, res: Response) {
    try {
        const { userId, messageIds } = req.body;
        if (!userId || !messageIds || !Array.isArray(messageIds)) {
            return res.status(400).json({ error: 'userId y messageIds (array) requeridos' });
        }

        await markMessagesDeleted(userId, messageIds);
        res.json({ success: true });
    } catch (error: any) {
        logger.error('❌ Error eliminando mensajes Gmail:', error);
        res.status(500).json({ error: 'Error eliminando mensajes', details: error.message });
    }
}
/**
 * Desarchiva mensajes de Gmail (volver a unread)
 */
export async function unarchiveGmailMessages(req: Request, res: Response) {
    try {
        const { userId, messageIds } = req.body;
        if (!userId || !messageIds || !Array.isArray(messageIds)) {
            return res.status(400).json({ error: 'userId y messageIds (array) requeridos' });
        }

        await unmarkMessagesArchived(userId, messageIds);
        res.json({ success: true });
    } catch (error: any) {
        logger.error('❌ Error desarchivando mensajes Gmail:', error);
        res.status(500).json({ error: 'Error desarchivando mensajes', details: error.message });
    }
}
