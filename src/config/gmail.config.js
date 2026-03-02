import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const redirectUri = process.env.GMAIL_REDIRECT_URI ||
    (process.env.BACKEND_URL ? `${process.env.BACKEND_URL.replace(/\/$/, '')}/auth/google/callback` : undefined);

// Log warning if no redirect URI is found (helper for debugging)
if (!redirectUri) {
    console.warn('⚠️ WARNING: No GMAIL_REDIRECT_URI or BACKEND_URL found. Gmail OAuth might fail.');
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
