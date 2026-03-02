-- Migración: Refinar preferencias de notificación
-- Fecha: 2026-02-08

-- Renombrar columnas para reflejar mejor la lógica de "Excepciones / Revisión"
ALTER TABLE user_configs 
RENAME COLUMN notify_on_invoice TO notify_rules_exceptions;

ALTER TABLE user_configs 
RENAME COLUMN notify_on_agent TO notify_ai_exceptions;

-- Actualizar comentarios
COMMENT ON COLUMN user_configs.notify_rules_exceptions IS 'Notificar si las reglas fallan (Categoría: Otros)';
COMMENT ON COLUMN user_configs.notify_ai_exceptions IS 'Notificar si la IA falla (Categoría: Otros)';
