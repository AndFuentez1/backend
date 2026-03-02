# Backend de Procesamiento de Facturas

Sistema automatizado para procesar facturas electrónicas desde Gmail, clasificarlas con IA y almacenarlas en Supabase.

## 🚀 Inicio Rápido

### 1. Instalar Dependencias

```bash
cd backend
npm install
```

### 2. Configurar Variables de Entorno

Copia `.env.example` a `.env` y completa las credenciales:

```bash
cp .env.example .env
```

Edita `.env` con tus credenciales:
- **Gmail OAuth2**: Obtén en [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
- **Gemini API**: Obtén en [Google AI Studio](https://makersuite.google.com/app/apikey)
- **Supabase**: Obtén en tu proyecto de Supabase

### 3. Iniciar Servidor

```bash
npm run dev
```

El servidor estará en `http://localhost:3001`

## 📋 Uso

### Paso 1: Autenticar con Gmail

1. Abre en tu navegador: `http://localhost:8080/auth/google`
2. Autoriza el acceso a tu cuenta de Gmail
3. Serás redirigido a una página de confirmación

### Paso 2: Procesar Facturas

Ejecuta el procesamiento manual:

```bash
POST http://localhost:3001/api/check-gmail
```

O usa curl:

```bash
curl -X POST http://localhost:3001/api/check-gmail
```

### Paso 3: Ver Resultados

Las facturas procesadas estarán en tu tabla `pending_invoices` de Supabase.

## 🔧 Endpoints Disponibles

### Autenticación

- `GET /auth/google` - Inicia OAuth flow
- `GET /auth/google/callback` - Callback de Google
- `GET /auth/status` - Verifica autenticación

### Procesamiento

- `POST /api/check-gmail` - Procesa facturas manualmente
- `GET /api/invoices/pending` - Lista facturas pendientes
- `POST /api/gmail-webhook` - Webhook para Pub/Sub (futuro)

### Health Check

- `GET /health` - Estado del servidor

## 📁 Estructura del Proyecto

```
backend/
├── src/
│   ├── config/          # Configuraciones (Gmail, Gemini, Supabase)
│   ├── controllers/     # Controladores de rutas
│   ├── services/        # Lógica de negocio
│   ├── routes/          # Definición de rutas
│   ├── middleware/      # Middleware personalizado
│   └── utils/           # Utilidades (logger, errors)
├── .tokens/             # Tokens OAuth2 (generado automáticamente)
├── logs/                # Logs del servidor
├── server.js            # Punto de entrada
└── package.json
```

## 🔐 Seguridad

- Los tokens OAuth2 se guardan localmente en `.tokens/gmail.json`
- Refresh automático de access tokens
- Validación de duplicados por `messageId`
- Logs detallados de todas las operaciones

## 🤖 Flujo de Procesamiento

1. **Buscar correos** con filtro: `has:attachment (factura OR invoice)`
2. **Descargar XMLs** de attachments
3. **Parsear XML** (facturas electrónicas colombianas)
4. **Clasificar localmente** con diccionario de keywords
5. **Re-clasificar con IA** si certeza < 90%
6. **Buscar IDs** de categoría y método de pago en Supabase
7. **Insertar** en `pending_invoices`
8. **Marcar como procesado** en Gmail

## 📊 Categorías Soportadas

Alimentación, Restaurantes, Transporte, Gasolina, Farmacia y Salud, Cuidado personal, Aseo y limpieza, Ropa y calzado, Educación, Gym, Teléfono, y más...

## 🐛 Debugging

Los logs se guardan en:
- `logs/combined.log` - Todos los logs
- `logs/error.log` - Solo errores

Ver logs en tiempo real:

```bash
tail -f logs/combined.log
```

## ⚙️ Configuración Avanzada

### Cambiar puerto

Edita `PORT` en `.env`

### Ajustar límite de correos

En `gmail.service.js`, línea 20:

```javascript
maxResults: 10, // Cambiar según necesidad
```

### Personalizar categorías

Edita `CATEGORY_KEYWORDS` en `classifier.service.js`

## 🔄 Próximas Mejoras

- [ ] Webhook automático con Gmail Pub/Sub
- [ ] Interfaz web para aprobar clasificaciones
- [ ] Soporte para más formatos de factura
- [ ] Exportar a Excel
- [ ] Notificaciones por correo

## 📝 Licencia

MIT
