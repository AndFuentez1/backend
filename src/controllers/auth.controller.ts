import type { Request, Response } from 'express';
import { GmailService } from '../services/gmail.service.ts';
import { saveGmailTokens, ensureUserConfig, loadGmailTokens } from '../services/userConfig.service.js';
import logger from '../utils/logger.js';

const renderErrorPage = (message: string) => `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Error de Conexión</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background-color: #ffffff;
        color: #0f172a;
      }
      .container {
        text-align: center;
        max-width: 320px;
        padding: 24px;
        animation: fadeIn 0.8s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .icon-wrapper {
        width: 56px;
        height: 56px;
        background-color: #fef2f2;
        color: #ef4444;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 24px;
      }
      .icon {
        width: 28px;
        height: 28px;
      }
      h1 {
        font-weight: 600;
        font-size: 18px;
        margin: 0 0 8px;
        letter-spacing: -0.02em;
        color: #0f172a;
      }
      p {
        color: #64748b;
        font-size: 14px;
        line-height: 1.5;
        margin: 0 0 24px;
      }
      .btn {
        background-color: #0f172a;
        color: white;
        border: none;
        padding: 10px 24px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        outline: none;
      }
      .btn:hover {
        background-color: #334155;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="icon-wrapper">
         <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </div>
      <h1>Error de Conexión</h1>
      <p>${message}</p>
      <button class="btn" onclick="window.close()">Cerrar Ventana</button>
    </div>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'GMAIL_ERROR', error: '${message}' }, '*');
      }
    </script>
  </body>
  </html>
`;

/**
 * Inicia el flujo de OAuth2 para un usuario específico
 */
export async function initiateOAuth(req: Request, res: Response) {
  try {
    const { userId, email } = req.query;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).send(renderErrorPage('ID de usuario no recibido. Por favor, asegúrate de estar logueado.'));
    }

    if (!email || typeof email !== 'string') {
      return res.status(400).send(renderErrorPage('Email de usuario no recibido. Por favor, intenta de nuevo.'));
    }

    const existingTokens = await loadGmailTokens(userId);
    // const hasRefreshToken = Boolean(existingTokens?.refresh_token);

    // Generar URL de autenticación con userId en state (Base64 para mayor seguridad en transporte)
    const stateData = { userId, email };
    const state = Buffer.from(JSON.stringify(stateData)).toString('base64');
    const gmailService = new GmailService();
    const authUrl = gmailService.getAuthUrl(state, {
      prompt: 'consent', // Always force consent to ensure refresh_token
      includeGrantedScopes: true,
      accessType: 'offline'
    });

    logger.info(`🔐 Redirigiendo a Google OAuth para usuario ${userId}. URL: ${authUrl}`);
    res.redirect(authUrl);
  } catch (error: unknown) {
    logger.error('❌ Error iniciando OAuth:', error);
    res.status(500).send(renderErrorPage('No se pudo iniciar la conexión con Google. Por favor, intenta de nuevo.'));
  }
}

/**
 * Callback de OAuth2 - recibe el código y lo intercambia por tokens
 */
export async function handleOAuthCallback(req: Request, res: Response) {
  try {
    const { code, state } = req.query;

    if (!code || typeof code !== 'string') {
      logger.warn(`⚠️ Callback OAuth sin código. Query: ${JSON.stringify(req.query)}`);
      return res.status(400).send(renderErrorPage('Código de autorización no recibido de Google.'));
    }

    if (!state || typeof state !== 'string') {
      logger.warn(`⚠️ Callback OAuth sin state. Query: ${JSON.stringify(req.query)}`);
      return res.status(400).send(renderErrorPage(`Error de seguridad: El parámetro 'state' de Google se perdió. (Recibidos: ${Object.keys(req.query).join(', ')})`));
    }

    // Parsear state para obtener userId y email
    let userId, email;
    try {
      const decodedState = Buffer.from(state, 'base64').toString();
      const parsedState = JSON.parse(decodedState);
      userId = parsedState.userId;
      email = parsedState.email;
    } catch (e) {
      logger.error('❌ Error parseando state OAuth:', e);
      return res.status(400).send(renderErrorPage('El estado de la sesión es inválido o ha sido alterado.'));
    }

    if (!email || !userId) {
      return res.status(400).send(renderErrorPage('No se pudo identificar al usuario. Por favor, intenta de nuevo desde la configuración.'));
    }

    logger.info(`🔑 Intercambiando código por tokens para usuario ${userId}...`);

    // Intercambiar código por tokens usando GmailService
    const gmailService = new GmailService();
    const tokens = await gmailService.setCredentials(code);

    // Asegurar que existe el registro de user_config
    await ensureUserConfig(userId, email);

    // Guardar tokens en Supabase (encriptados)
    await saveGmailTokens(userId, tokens);

    logger.info(`✅ Autenticación exitosa para usuario ${userId}`);

    // Redirigir a página de éxito
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Conexión Exitosa</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background-color: #ffffff;
            color: #0f172a;
          }
          .container {
            text-align: center;
            max-width: 320px;
            padding: 24px;
            animation: fadeIn 0.8s cubic-bezier(0.16, 1, 0.3, 1);
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .icon-wrapper {
            width: 56px;
            height: 56px;
            background-color: #f0fdf4;
            color: #16a34a;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
          }
          /* Minimalist check icon */
          .icon {
            width: 28px;
            height: 28px;
          }
          h1 {
            font-weight: 600;
            font-size: 18px;
            margin: 0 0 8px;
            letter-spacing: -0.02em;
            color: #0f172a;
          }
          p {
            color: #64748b;
            font-size: 14px;
            line-height: 1.5;
            margin: 0 0 24px;
          }
          .btn {
            background-color: #0f172a;
            color: white;
            border: none;
            padding: 10px 24px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
            outline: none;
          }
          .btn:hover {
            background-color: #334155;
            transform: translateY(-1px);
          }
          .btn:active {
            transform: translateY(0);
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon-wrapper">
             <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
          </div>
          <h1>Conectado</h1>
          <p>Ya puedes cerrar esta ventana.</p>
          <button class="btn" onclick="window.close()">Cerrar</button>
        </div>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'GMAIL_CONNECTED', status: 'success' }, '*');
            setTimeout(() => window.close(), 1500);
          }
        </script>
      </body>
      </html>
    `);
  } catch (error: unknown) {
    logger.error('❌ Error en callback OAuth:', error);
    const errMessage = error instanceof Error ? error.message : 'Ocurrió un error inesperado al conectar con Gmail.';
    res.status(500).send(renderErrorPage(errMessage));
  }
}

/**
 * Verifica el estado de autenticación de un usuario
 */
export async function checkAuthStatus(req: Request, res: Response) {
  try {
    const { userId } = req.query;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId requerido' });
    }

    const tokens = await loadGmailTokens(userId);

    res.json({
      authenticated: !!tokens,
      message: tokens
        ? 'Gmail conectado'
        : 'Gmail no conectado. Inicia el flujo OAuth.',
    });
  } catch (error) {
    logger.error('❌ Error verificando estado:', error);
    res.status(500).json({ error: 'Error verificando autenticación' });
  }
}
