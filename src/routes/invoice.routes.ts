import express from 'express';
import {
    processGmailInvoices,
    handleGmailWebhook,
    listPendingInvoices,
    searchGmailHistory,
    importGmailBatch,
    archiveGmailMessages,
    deleteGmailMessages,
    unarchiveGmailMessages
} from '../controllers/invoice.controller.ts'; // Imports form .ts file... wait, if I use .js in import, tsx might resolve to .ts? 
// And I wrote `auth.controller.ts`.
// So I am betting on `tsx` resolving `.js` import to `.ts` file? 
// Or actually I should probably use `.ts` in import if I am running raw TS.
// Let's use `.ts` to be explicit for `tsx`. 
// I'll update `auth.routes.ts` too if needed. 
// Start with `invoice.routes.ts` using `.js` first, if it fails I'll fix.
// Actually, `tsx` recommends using extensions.
// Let's stick to what works in `server.js`: `import ... from '...ts'`.
// So inside `invoice.routes.ts`, import `...controller.ts`.

const router = express.Router();

// Procesar facturas manualmente
router.post('/check-gmail', processGmailInvoices);

// Buscar en historial de Gmail
router.get('/gmail/search', searchGmailHistory);

// Importar lote de mensajes
router.post('/gmail/import-batch', importGmailBatch);

// Archivar mensajes en historial (revisados)
router.post('/gmail/archive', archiveGmailMessages);

// Eliminar mensajes del historial
router.post('/gmail/delete', deleteGmailMessages);

// Desarchivar mensajes del historial
router.post('/gmail/unarchive', unarchiveGmailMessages);

// Webhook para Gmail Pub/Sub (futuro)
router.post('/gmail-webhook', handleGmailWebhook);

// Listar facturas pendientes
router.get('/invoices/pending', listPendingInvoices);

export default router;
