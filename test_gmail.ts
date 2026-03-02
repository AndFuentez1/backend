import { GmailService } from './src/services/gmail.service.js';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

const gmailService = new GmailService();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const tokens = {
    // Paste your REFRESH TOKEN here if you want to test token refresh logic directly
    refresh_token: process.env.TEST_REFRESH_TOKEN,
    access_token: process.env.TEST_ACCESS_TOKEN
};

async function main() {
    console.log('🚀 Starting Gmail Service Test...');

    try {
        if (tokens.refresh_token) {
            console.log('🔄 Using existing refresh token...');
            gmailService.setTokens(tokens);
        } else {
            // 1. Get Auth URL
            const state = JSON.stringify({ userId: 'test-user-id', email: 'test@example.com' });
            const authUrl = gmailService.getAuthUrl(state);
            console.log('\n🔗  Authorize this app by visiting this url:', authUrl);

            // 2. Enter Code
            const code = await new Promise<string>((resolve) => {
                rl.question('\n📋  Enter the code from that page here: ', (code) => {
                    resolve(code);
                });
            });

            // 3. Exchange Code for Tokens
            console.log('\n⏳  Exchanging code for tokens...');
            const newTokens = await gmailService.setCredentials(code);
            console.log('✅  Tokens received:', newTokens);
        }

        // 4. Fetch Profile
        const profile = await gmailService.getProfile();
        console.log('\n👤  Connected User:', profile.emailAddress);

        // 5. Fetch Invoices
        console.log('\n🔍  Searching for invoices...');
        const invoices = await gmailService.findRecentInvoices(30);
        console.log(`\n📄  Found ${invoices.length} potential invoices:`);
        invoices.forEach((inv: any) => {
            console.log(`   - [${inv.internalDate}] ${inv.subject} (ID: ${inv.id})`);
        });

    } catch (error) {
        console.error('\n❌  Error:', error);
    } finally {
        rl.close();
    }
}

main();
