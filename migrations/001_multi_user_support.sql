-- Migración: Soporte Multi-Usuario para Procesamiento de Facturas
-- Fecha: 2026-02-07

-- 1. Crear tabla de configuraciones de usuario
CREATE TABLE IF NOT EXISTS user_configs (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  
  -- Credenciales encriptadas
  gmail_tokens TEXT, -- JSON encriptado con tokens OAuth2
  gemini_api_key TEXT, -- API key encriptada
  telegram_bot_token TEXT, -- Token encriptado (opcional)
  telegram_chat_id TEXT, -- Chat ID (opcional)
  
  -- Metadata
  gmail_connected_at TIMESTAMPTZ,
  gemini_configured_at TIMESTAMPTZ,
  telegram_configured_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Habilitar Row Level Security
ALTER TABLE user_configs ENABLE ROW LEVEL SECURITY;

-- 3. Política: Usuarios solo pueden ver/editar su propia configuración
CREATE POLICY "Users can manage their own config"
  ON user_configs
  FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 4. Índices para optimizar búsquedas
CREATE INDEX idx_user_configs_email ON user_configs(email);
CREATE INDEX idx_user_configs_id ON user_configs(id);

-- 5. Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_user_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Trigger para actualizar updated_at
CREATE TRIGGER trigger_update_user_configs_updated_at
  BEFORE UPDATE ON user_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_user_configs_updated_at();

-- 7. Verificar que pending_invoices tenga RLS habilitado
ALTER TABLE pending_invoices ENABLE ROW LEVEL SECURITY;

-- 8. Política: Usuarios solo pueden ver sus propias facturas
DROP POLICY IF EXISTS "Users can view their own invoices" ON pending_invoices;
CREATE POLICY "Users can view their own invoices"
  ON pending_invoices
  FOR SELECT
  USING (auth.uid() = user_id);

-- 9. Política: Usuarios solo pueden insertar sus propias facturas
DROP POLICY IF EXISTS "Users can insert their own invoices" ON pending_invoices;
CREATE POLICY "Users can insert their own invoices"
  ON pending_invoices
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 10. Política: Usuarios solo pueden actualizar sus propias facturas
DROP POLICY IF EXISTS "Users can update their own invoices" ON pending_invoices;
CREATE POLICY "Users can update their own invoices"
  ON pending_invoices
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 11. Política: Usuarios solo pueden eliminar sus propias facturas
DROP POLICY IF EXISTS "Users can delete their own invoices" ON pending_invoices;
CREATE POLICY "Users can delete their own invoices"
  ON pending_invoices
  FOR DELETE
  USING (auth.uid() = user_id);

-- Comentarios
COMMENT ON TABLE user_configs IS 'Configuraciones por usuario para procesamiento de facturas';
COMMENT ON COLUMN user_configs.gmail_tokens IS 'Tokens OAuth2 de Gmail encriptados con AES-256';
COMMENT ON COLUMN user_configs.gemini_api_key IS 'API Key de Gemini encriptada con AES-256';
COMMENT ON COLUMN user_configs.telegram_bot_token IS 'Token del bot de Telegram encriptado (opcional)';
