
import dotenv from 'dotenv';

console.log('Script started');
dotenv.config({ path: 'backend/.env' });

console.log('Env loaded');
console.log('SUPABASE_URL present:', !!process.env.SUPABASE_URL);
console.log('ENCRYPTION_KEY present:', !!process.env.ENCRYPTION_KEY);

const userId = 'cf5d23b9-4d83-467d-860d-35a70ea70d88';

async function debugTokens() {
    const { loadGmailTokens, getUserConfigStatus } = await import('../src/services/userConfig.service.js');

    console.log(`🔍 Debugging tokens for user: ${userId}`);

    try {
        const status = await getUserConfigStatus(userId);
        console.log('User Config Status:', status);

        const tokens = await loadGmailTokens(userId);
        if (!tokens) {
            console.log('❌ No tokens found for user.');
        } else {
            console.log('✅ Tokens found.');
            console.log('Keys present:', Object.keys(tokens));
            console.log('Access Token present:', !!tokens.access_token);
            console.log('Refresh Token present:', !!tokens.refresh_token);
            if (tokens.refresh_token) {
                console.log('Refresh Token length:', tokens.refresh_token.length);
            } else {
                console.log('⚠️ REFRESH TOKEN MISSING OR EMPTY!');
            }
            console.log('Expiry Date:', tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'None');
        }

    } catch (error) {
        console.error('❌ Error debugging tokens:', error);
    }
}

debugTokens();
