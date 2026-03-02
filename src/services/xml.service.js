import xml2js from 'xml2js';
import logger from '../utils/logger.js';

const readText = (value) => {
    if (value === null || value === undefined) { return null; }
    if (typeof value === 'string' || typeof value === 'number') { return value.toString(); }
    // When xml2js parses multiple sibling nodes with the same tag (e.g. multiple <cbc:Description>),
    // it produces an array. Take the first non-empty element instead of returning null.
    if (Array.isArray(value)) {
        for (const item of value) {
            const text = readText(item);
            if (text !== null && text.trim() !== '') { return text; }
        }
        return null;
    }
    if (typeof value === 'object') {
        if (Object.prototype.hasOwnProperty.call(value, '_')) { return value._.toString(); }
        if (Object.prototype.hasOwnProperty.call(value, '#text')) { return value['#text'].toString(); }
    }
    return null;
};

const parseNumber = (value) => {
    const text = readText(value);
    if (!text) { return 0; }
    // Remove currency symbols, thousands separators and handle decimal commas
    let normalized = text.toString().trim()
        .replace(/[^\d.,-]/g, ''); // Keep numbers, dots, commas and minus

    if (!normalized) { return 0; }

    const hasComma = normalized.includes(',');
    const hasDot = normalized.includes('.');

    if (hasComma && hasDot) {
        // If comma appears after dot, assume dot is thousands separator (e.g. 1.234,56)
        if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
            normalized = normalized.replace(/\./g, '').replace(/,/g, '.');
        } else {
            // Assume comma is thousands separator (e.g. 1,234.56)
            normalized = normalized.replace(/,/g, '');
        }
    } else if (hasComma && !hasDot) {
        // Only comma: treat as decimal (e.g. 1234,56)
        normalized = normalized.replace(/,/g, '.');
    }

    const parsed = parseFloat(normalized);
    return Number.isNaN(parsed) ? 0 : parsed;
};

const ensureArray = (value) => {
    if (!value) { return []; }
    return Array.isArray(value) ? value : [value];
};

const normalizeText = (text) => {
    if (!text) { return ''; }
    return text
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .trim();
};

const extractNoteByLocale = (notes, locale) => {
    const list = ensureArray(notes);
    return list.find(note => note?.$?.languageLocaleID === locale);
};

const inferPaymentMethod = (paymentMeansCode, noteText) => {
    const normalized = normalizeText(noteText);
    if (normalized.includes('TARJET') && normalized.includes('CRED')) { return 'Tarjeta de Crédito'; }
    if (normalized.includes('TARJET') && normalized.includes('DEBIT')) { return 'Tarjeta Débito'; }
    if (normalized.includes('TARJET')) { return 'Tarjeta'; }
    if (normalized.includes('EFECT') || normalized.includes('CONTADO') || normalized.includes('CASH')) { return 'Efectivo'; }
    if (normalized.includes('TRANSFER') || normalized.includes('PSE')) { return 'Transferencia'; }
    if (paymentMeansCode) { return paymentMeansCode.toString().trim(); }
    return null;
};

const extractEmbeddedInvoiceXml = (xmlData) => {
    try {
        const extractInvoiceFromRaw = (rawValue) => {
            if (!rawValue) { return null; }
            let raw = rawValue.toString();
            if (raw.includes('&lt;') || raw.includes('&gt;')) {
                raw = raw
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&amp;/g, '&')
                    .replace(/&quot;/g, '"')
                    .replace(/&apos;/g, "'");
            }
            const patterns = [
                /<Invoice[\s\S]*<\/Invoice>/i,
                /<CreditNote[\s\S]*<\/CreditNote>/i,
                /<DebitNote[\s\S]*<\/DebitNote>/i,
                /<ApplicationResponse[\s\S]*<\/ApplicationResponse>/i
            ];
            for (const pattern of patterns) {
                const match = raw.match(pattern);
                if (match) {
                    logger.info(`✨ XML embebido encontrado (${pattern.toString()})`);
                    return match[0];
                }
            }
            return null;
        };

        const isProbablyBase64 = (rawValue) => {
            if (!rawValue) { return false; }
            const cleaned = rawValue.toString().replace(/\s+/g, '');
            if (cleaned.length < 200) { return false; }
            if (cleaned.length % 4 !== 0) { return false; }
            return /^[A-Za-z0-9+/=]+$/.test(cleaned);
        };

        const decodeBase64 = (rawValue) => {
            if (!rawValue) { return null; }
            try {
                const cleaned = rawValue.toString().replace(/\s+/g, '');
                const decoded = Buffer.from(cleaned, 'base64').toString('utf-8');
                return decoded;
            } catch {
                return null;
            }
        };

        const scanForEmbeddedInvoice = (node, path = 'root', depth = 0, state = { scanned: 0 }) => {
            if (!node) { return null; }
            if (depth > 8 || state.scanned > 2500) { return null; }
            state.scanned += 1;

            if (typeof node === 'string' || typeof node === 'number') {
                const raw = node.toString();
                const direct = extractInvoiceFromRaw(raw);
                if (direct) { return { xml: direct, source: 'inline', path }; }
                if (isProbablyBase64(raw)) {
                    const decoded = decodeBase64(raw);
                    const decodedMatch = extractInvoiceFromRaw(decoded || '');
                    if (decodedMatch) { return { xml: decodedMatch, source: 'base64', path }; }
                }
                return null;
            }

            if (Array.isArray(node)) {
                for (let i = 0; i < node.length; i += 1) {
                    const res = scanForEmbeddedInvoice(node[i], `${path}[${i}]`, depth + 1, state);
                    if (res) { return res; }
                }
                return null;
            }

            if (typeof node === 'object') {
                if (Object.prototype.hasOwnProperty.call(node, '_')) {
                    const res = scanForEmbeddedInvoice(node._, `${path}._`, depth + 1, state);
                    if (res) { return res; }
                }
                if (Object.prototype.hasOwnProperty.call(node, '#text')) {
                    const res = scanForEmbeddedInvoice(node['#text'], `${path}.#text`, depth + 1, state);
                    if (res) { return res; }
                }
                for (const [key, value] of Object.entries(node)) {
                    if (key === '_' || key === '#text') { continue; }
                    const res = scanForEmbeddedInvoice(value, `${path}.${key}`, depth + 1, state);
                    if (res) { return res; }
                }
            }

            return null;
        };

        const descriptions = [];
        const pushDescription = (value) => {
            if (!value) { return; }
            if (Array.isArray(value)) {
                value.forEach(pushDescription);
                return;
            }
            descriptions.push(value);
        };

        // Buscar en rutas comunes de AttachedDocument
        pushDescription(xmlData?.['cac:Attachment']?.['cac:ExternalReference']?.['cbc:Description']);
        pushDescription(
            xmlData?.['cac:ParentDocumentLineReference']?.['cac:DocumentReference']?.['cac:Attachment']?.['cac:ExternalReference']?.['cbc:Description']
        );

        const additionalRefs = ensureArray(xmlData?.['cac:AdditionalDocumentReference']);
        additionalRefs.forEach(ref =>
            pushDescription(ref?.['cac:Attachment']?.['cac:ExternalReference']?.['cbc:Description'])
        );

        for (const description of descriptions) {
            const raw = readText(description);
            if (!raw) { continue; }
            const directMatch = extractInvoiceFromRaw(raw);
            if (directMatch) { return directMatch; }
        }

        const embeddedObjects = [];
        const pushEmbedded = (value) => {
            if (!value) { return; }
            if (Array.isArray(value)) {
                value.forEach(pushEmbedded);
                return;
            }
            embeddedObjects.push(value);
        };

        pushEmbedded(xmlData?.['cac:Attachment']?.['cbc:EmbeddedDocumentBinaryObject']);
        pushEmbedded(xmlData?.['cac:ParentDocumentLineReference']?.['cac:DocumentReference']?.['cac:Attachment']?.['cbc:EmbeddedDocumentBinaryObject']);
        additionalRefs.forEach(ref => pushEmbedded(ref?.['cac:Attachment']?.['cbc:EmbeddedDocumentBinaryObject']));

        for (const embedded of embeddedObjects) {
            const raw = readText(embedded);
            if (!raw) { continue; }
            const directMatch = extractInvoiceFromRaw(raw);
            if (directMatch) { return directMatch; }
            if (isProbablyBase64(raw)) {
                const decoded = decodeBase64(raw);
                if (!decoded) { continue; }
                const decodedMatch = extractInvoiceFromRaw(decoded);
                if (decodedMatch) { return decodedMatch; }
            }
        }

        const deepScan = scanForEmbeddedInvoice(xmlData);
        if (deepScan) {
            logger.info(`✨ XML embebido encontrado (deep:${deepScan.source} @ ${deepScan.path})`);
            return deepScan.xml;
        }

        return null;
    } catch (error) {
        logger.warn('⚠️ No se pudo extraer Invoice embebido:', error);
        return null;
    }
};

export async function parseInvoiceXML(xmlString) {
    try {
        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(xmlString);

        // La estructura puede variar, pero generalmente es AttachedDocument o Invoice
        const doc = result.AttachedDocument || result.Invoice || result.CreditNote || result.DebitNote || result.ApplicationResponse || result;

        return doc;
    } catch (error) {
        logger.error('❌ Error parseando XML:', error);
        throw new Error('Error parseando XML: ' + error.message);
    }
}

/**
 * Extrae metadata de la factura (fecha, tienda, total)
 */
export function extractMetadata(xmlData) {
    try {
        // En AttachedDocument, el emisor está en cac:SenderParty o cac:ReceiverParty
        // Pero nosotros queremos el AccountingSupplierParty del Invoice embebido.
        // Si falló el unwrapping, intentamos sacar algo de AttachedDocument.
        const supplierParty =
            xmlData?.['cac:AccountingSupplierParty']?.['cac:Party'] ||
            xmlData?.['cac:SenderParty'] ||
            xmlData?.['cac:ReceiverParty'];

        // Nombres en diferentes rutas posibles de DIAN
        const supplierName =
            readText(supplierParty?.['cac:PartyTaxScheme']?.['cbc:RegistrationName']) ||
            readText(supplierParty?.['cac:PartyLegalEntity']?.['cbc:RegistrationName']) ||
            readText(supplierParty?.['cac:PartyName']?.['cbc:Name']) ||
            readText(xmlData?.['cbc:ID']) || // A veces el ID contiene el nombre separado por ;
            null;

        const tiendaRaw =
            readText(supplierParty?.['cac:PartyName']?.['cbc:Name']) ||
            readText(supplierParty?.['cac:PartyLegalEntity']?.['cbc:RegistrationName']) ||
            readText(supplierParty?.['cac:PartyTaxScheme']?.['cbc:RegistrationName']) ||
            readText(xmlData?.['cbc:ID']) ||
            'Tienda Desconocida';

        const tienda = cleanStoreName(tiendaRaw);

        const address =
            supplierParty?.['cac:PhysicalLocation']?.['cac:Address'] ||
            supplierParty?.['cac:PostalAddress'] ||
            supplierParty?.['cac:PartyLegalEntity']?.['cac:RegistrationAddress'];

        const addressLines = ensureArray(address?.['cac:AddressLine']);
        const addressLine =
            addressLines.map(line => readText(line?.['cbc:Line']) || readText(line)).filter(Boolean).join(' ') ||
            readText(address?.['cbc:StreetName']) ||
            readText(address?.['cbc:Line']) ||
            null;

        const ciudad =
            readText(address?.['cbc:CityName']) ||
            readText(address?.['cbc:CitySubdivisionName']) ||
            readText(address?.['cbc:District']) ||
            null;

        const paymentMeans = ensureArray(xmlData?.['cac:PaymentMeans']);
        const paymentMeansCode =
            readText(paymentMeans[0]?.['cbc:PaymentMeansCode']) ||
            readText(xmlData?.['cac:PaymentMeans']?.['cbc:PaymentMeansCode']) ||
            null;

        const notes = xmlData?.['cbc:Note'];
        const noteLocale = extractNoteByLocale(notes, 'Nota7') || extractNoteByLocale(notes, 'Nota 7');
        const noteText =
            readText(noteLocale) ||
            readText(ensureArray(notes).find(note => normalizeText(readText(note)).includes('MEDIOS DE PAGO'))) ||
            readText(notes) ||
            null;

        const paymentMethod = inferPaymentMethod(paymentMeansCode, noteText);

        // Fecha: DIAN usa cbc:IssueDate y a veces cbc:IssueTime
        let fecha = readText(xmlData['cbc:IssueDate']) ||
            readText(xmlData['cac:AccountingSupplierParty']?.['cac:Party']?.['cbc:IssueDate']) ||
            readText(xmlData['cbc:ParentDocumentID']); // Fallback raro

        if (!fecha) {
            fecha = new Date().toISOString().split('T')[0];
        }

        // Totales legales en DIAN
        const monetaryTotal =
            xmlData['cac:LegalMonetaryTotal'] ||
            xmlData['cac:RequestedMonetaryTotal'] ||
            {};

        const total =
            parseNumber(monetaryTotal['cbc:PayableAmount']) ||
            parseNumber(monetaryTotal['cbc:TaxInclusiveAmount']) ||
            parseNumber(monetaryTotal['cbc:LineExtensionAmount']) ||
            0;

        return {
            fecha,
            tienda,
            proveedor: supplierName || tiendaRaw,
            ciudad,
            direccion: addressLine,
            paymentMeansCode,
            paymentNote: noteText,
            paymentMethod,
            total,
        };
    } catch (error) {
        logger.error('❌ Error extrayendo metadata:', error);
        return {
            fecha: new Date().toISOString().split('T')[0],
            tienda: 'Desconocida',
            proveedor: null,
            ciudad: null,
            direccion: null,
            paymentMeansCode: null,
            paymentNote: null,
            paymentMethod: null,
            total: 0,
        };
    }
}

/**
 * Limpia el nombre de la tienda (quitar caracteres especiales, etc)
 */
function cleanStoreName(name) {
    if (!name) return 'TIENDA DESCONOCIDA';

    let cleaned = name.toString().trim();

    // Manejar formato DIAN NIT;NOMBRE;ID (ej: 890900608;ALMACENES ÉXITO S.A;SC84...)
    if (cleaned.includes(';')) {
        const parts = cleaned.split(';');
        // Buscar la parte que parezca más un nombre (más de 3 letras, no solo números)
        cleaned = parts.find(p => {
            const trimmed = p.trim();
            return trimmed.length > 3 && /[A-Z]/.test(trimmed.toUpperCase()) && !/^\d+$/.test(trimmed);
        }) || parts[1] || parts[0];
    }

    return cleaned
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[^\w\s-ÁÉÍÓÚÑ]/gi, '')
        .toUpperCase()
        .substring(0, 100) || 'TIENDA DESCONOCIDA';
}

/**
 * Extrae las líneas de productos de la factura
 */
export function extractProducts(xmlData) {
    try {
        // Buscar líneas de factura (Invoice o CreditNote) con y sin prefijos
        let lines =
            xmlData['cac:InvoiceLine'] ||
            xmlData['cac:CreditNoteLine'] ||
            xmlData['cac:DebitNoteLine'] ||
            xmlData['InvoiceLine'] ||
            xmlData['CreditNoteLine'] ||
            xmlData['DebitNoteLine'] ||
            [];

        // Si es un solo item, convertir a array
        if (!Array.isArray(lines)) {
            lines = [lines];
        }

        const products = lines.filter(Boolean).map((line, index) => {
            const item = line['cac:Item'] || line['Item'] || {};
            const description =
                readText(item['cbc:Description']) ||
                readText(item['cbc:Name']) ||
                readText(item['Description']) ||
                readText(item['Name']) ||
                `Producto ${index + 1}`;

            const code =
                readText(item?.['cac:StandardItemIdentification']?.['cbc:ID']) ||
                readText(item?.['cac:SellersItemIdentification']?.['cbc:ID']) ||
                readText(item?.['StandardItemIdentification']?.['ID']) ||
                null;

            const quantity = parseNumber(line['cbc:InvoicedQuantity']) || parseNumber(line['cbc:CreditedQuantity']) || parseNumber(line['InvoicedQuantity']) || 1;

            const priceAmountNode = line['cac:Price'] || line['Price'] || {};
            const price = parseNumber(priceAmountNode['cbc:PriceAmount']) || parseNumber(priceAmountNode['PriceAmount']) || 0;

            const lineExtensionAmount = parseNumber(line['cbc:LineExtensionAmount']) || parseNumber(line['LineExtensionAmount']) || (price * quantity);

            const taxTotals = ensureArray(line['cac:TaxTotal'] || line['TaxTotal']);
            const taxTotal = taxTotals.length > 0 ? taxTotals[0] : null;
            const taxSubtotal = ensureArray(taxTotal?.['cac:TaxSubtotal'] || taxTotal?.['TaxSubtotal'])[0];

            const taxAmount =
                parseNumber(taxTotal?.['cbc:TaxAmount']) ||
                parseNumber(taxTotal?.['TaxAmount']) ||
                parseNumber(taxSubtotal?.['cbc:TaxAmount']) ||
                0;

            const totalWithTax = lineExtensionAmount + taxAmount;

            return {
                description: description.toString().trim(),
                quantity,
                price,
                total: Number(totalWithTax.toFixed(2)),
                totalExclTax: Number(lineExtensionAmount.toFixed(2)),
                taxAmount: Number(taxAmount.toFixed(2)),
                code
            };
        });

        logger.info(`📦 Extraídos ${products.length} productos`);
        return products;
    } catch (error) {
        logger.error('❌ Error extrayendo productos:', error);
        return [];
    }
}

/**
 * Función principal: Procesa un XML completo
 */
export async function processInvoiceXML(xmlString) {
    try {
        // 1. Parsear XML
        let xmlData = await parseInvoiceXML(xmlString);

        // 1.1. Si es AttachedDocument con Invoice embebido, parsear el Invoice real
        const embeddedInvoice = extractEmbeddedInvoiceXml(xmlData);
        if (embeddedInvoice) {
            xmlData = await parseInvoiceXML(embeddedInvoice);
        }

        // 2. Extraer metadata
        const metadata = extractMetadata(xmlData);

        // 3. Extraer productos
        let products = extractProducts(xmlData);

        if (products.length === 0 || metadata.total === 0) {
            logger.warn(`⚠️ Extracción incompleta: productos=${products.length}, total=${metadata.total || 0}, tienda=${metadata.tienda}`);
        }

        // 3.1 Fallback si no hay productos pero hay total (Para asegurar que se genere al menos un registro)
        if (products.length === 0 && metadata.total > 0) {
            logger.warn(`⚠️ No se detectaron productos individuales, usando fallback para total $${metadata.total}`);
            products = [{
                description: `Compra en ${metadata.tienda}`,
                quantity: 1,
                price: metadata.total,
                total: metadata.total,
                totalExclTax: metadata.total,
                taxAmount: 0,
                code: 'GENERIC'
            }];
        }

        return {
            ...metadata,
            productos: products,
            productNames: products.map(p => p.description).join(', ')
        };
    } catch (error) {
        logger.error('❌ Error procesando factura XML:', error);
        // Fallback mínimo para no romper el flujo
        return {
            fecha: new Date().toISOString().split('T')[0],
            tienda: 'ERROR AL PROCESAR',
            total: 0,
            productos: [],
            error: error.message
        };
    }
}
