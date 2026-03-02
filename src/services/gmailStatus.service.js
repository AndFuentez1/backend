import supabase from '../config/supabase.config.js';
import logger from '../utils/logger.js';

const TABLE = 'gmail_message_status';
const STATUS_ARCHIVED = 'archived';
const STATUS_APPROVED_LEGACY = 'approved';
const STATUS_DELETED = 'deleted';

function normalizeStatus(status) {
    if (status === STATUS_APPROVED_LEGACY) return STATUS_ARCHIVED;
    return status;
}

export async function fetchMessageStatuses(userId, messageIds) {
    try {
        if (!userId || !messageIds || messageIds.length === 0) return {};

        const { data, error } = await supabase
            .from(TABLE)
            .select('message_id, status')
            .eq('user_id', userId)
            .in('message_id', messageIds);

        if (error) throw error;

        const statusMap = {};
        (data || []).forEach(row => {
            statusMap[row.message_id] = normalizeStatus(row.status);
        });

        return statusMap;
    } catch (error) {
        logger.error('❌ Error obteniendo estados de Gmail:', error);
        return {};
    }
}

export async function markMessagesRead(userId, messageIds) {
    try {
        if (!userId || !messageIds || messageIds.length === 0) return;

        const { data: existing, error: existingError } = await supabase
            .from(TABLE)
            .select('message_id, status')
            .eq('user_id', userId)
            .in('message_id', messageIds);

        if (existingError) throw existingError;

        const protectedSet = new Set((existing || [])
            .filter(r => {
                const status = normalizeStatus(r.status);
                return status === STATUS_ARCHIVED || status === STATUS_DELETED;
            })
            .map(r => r.message_id));

        const now = new Date().toISOString();
        const toUpsert = messageIds
            .filter(id => !protectedSet.has(id))
            .map(id => ({
                user_id: userId,
                message_id: id,
                status: 'read',
                read_at: now,
                updated_at: now
            }));

        if (toUpsert.length === 0) return;

        const { error } = await supabase
            .from(TABLE)
            .upsert(toUpsert, { onConflict: 'user_id,message_id' });

        if (error) throw error;
    } catch (error) {
        logger.error('❌ Error marcando mensajes como leídos:', error);
    }
}

export async function markMessagesArchived(userId, messageIds) {
    try {
        if (!userId || !messageIds || messageIds.length === 0) return;

        const now = new Date().toISOString();
        const toUpsert = messageIds.map(id => ({
            user_id: userId,
            message_id: id,
            status: STATUS_ARCHIVED,
            approved_at: now,
            updated_at: now
        }));

        const { error } = await supabase
            .from(TABLE)
            .upsert(toUpsert, { onConflict: 'user_id,message_id' });

        if (error) throw error;
    } catch (error) {
        logger.error('❌ Error marcando mensajes como archivados:', error);
    }
}

// Backward compatibility name
export async function markMessagesApproved(userId, messageIds) {
    return markMessagesArchived(userId, messageIds);
}

export async function markMessagesDeleted(userId, messageIds) {
    try {
        if (!userId || !messageIds || messageIds.length === 0) return;

        const now = new Date().toISOString();
        const toUpsert = messageIds.map(id => ({
            user_id: userId,
            message_id: id,
            status: STATUS_DELETED,
            updated_at: now
        }));

        const { error } = await supabase
            .from(TABLE)
            .upsert(toUpsert, { onConflict: 'user_id,message_id' });

        if (error) throw error;
    } catch (error) {
        logger.error('❌ Error marcando mensajes como eliminados:', error);
    }
}

export async function fetchRegisteredMessageIds(userId, messageIds) {
    try {
        if (!userId || !messageIds || messageIds.length === 0) return new Set();

        const { data, error } = await supabase
            .from('pending_invoices')
            .select('message_id')
            .eq('user_id', userId)
            .in('message_id', messageIds);

        if (error) throw error;

        return new Set((data || []).map(row => row.message_id).filter(Boolean));
    } catch (error) {
        logger.error('❌ Error verificando mensajes registrados:', error);
        return new Set();
    }
}
export async function unmarkMessagesArchived(userId, messageIds) {
    try {
        if (!userId || !messageIds || messageIds.length === 0) return;

        const now = new Date().toISOString();
        const toUpsert = messageIds.map(id => ({
            user_id: userId,
            message_id: id,
            status: 'unread', // Volver a unread o simplemente borrar el registro
            updated_at: now
        }));

        const { error } = await supabase
            .from(TABLE)
            .upsert(toUpsert, { onConflict: 'user_id,message_id' });

        if (error) throw error;
    } catch (error) {
        logger.error('❌ Error desarchivando mensajes de Gmail:', error);
    }
}
