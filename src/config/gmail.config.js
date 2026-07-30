import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

let redirectUri = process.env.GMAIL_REDIRECT_URI;

// Auto-detect and correct redirect URI if running on Render in production
const isRunningOnRender = process.env.RENDER === 'true' || !!process.env.RENDER_EXTERNAL_URL;
if (isRunningOnRender && (!redirectUri || redirectUri.includes('localhost') || redirectUri.includes('127.0.0.1'))) {
    if (process.env.RENDER_EXTERNAL_URL) {
        redirectUri = `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/auth/google/callback`;
    }
}

if (!redirectUri && process.env.BACKEND_URL) {
    redirectUri = `${process.env.BACKEND_URL.replace(/\/$/, '')}/auth/google/callback`;
}

// Log warning if no redirect URI is found (helper for debugging)
if (!redirectUri) {
    console.warn('⚠️ WARNING: No GMAIL_REDIRECT_URI, RENDER_EXTERNAL_URL, or BACKEND_URL found. Gmail OAuth might fail.');
}

const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    redirectUri
);

// Scopes necesarios para Gmail
const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify', // Para marcar como leído
];

export { oauth2Client, SCOPES };
