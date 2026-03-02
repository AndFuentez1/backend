-- Migración: Preferencias de Notificaciones de Telegram
-- Fecha: 2026-02-08

ALTER TABLE user_configs 
ADD COLUMN IF NOT EXISTS notify_on_invoice BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS notify_on_agent BOOLEAN DEFAULT TRUE;

-- Actualizar comentario
COMMENT ON COLUMN user_configs.notify_on_invoice IS 'Enviar notificación cuando llega una factura';
COMMENT ON COLUMN user_configs.notify_on_agent IS 'Enviar notificación cuando el agente clasifica/verifica';
