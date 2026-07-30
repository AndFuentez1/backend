import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, encryptJSON, decryptJSON } from '../encryption.service.js';

describe('encryption.service', () => {
    const testUserId = 'user-12345-abcde';
    const sampleText = '123456789:AAFgH-TelegramBotTokenSecret';

    it('should encrypt and decrypt a text string correctly using userId', async () => {
        const encrypted = await encrypt(sampleText, testUserId);
        expect(encrypted).toBeDefined();
        expect(typeof encrypted).toBe('string');
        expect(encrypted).toContain(':');

        const decrypted = await decrypt(encrypted, testUserId);
        expect(decrypted).toBe(sampleText);
    });

    it('should return null when encrypting or decrypting empty/null values', async () => {
        const encryptedNull = await encrypt(null, testUserId);
        expect(encryptedNull).toBeNull();

        const decryptedNull = await decrypt(null, testUserId);
        expect(decryptedNull).toBeNull();
    });

    it('should generate different ciphertexts (IVs) for identical input strings', async () => {
        const encrypted1 = await encrypt(sampleText, testUserId);
        const encrypted2 = await encrypt(sampleText, testUserId);

        expect(encrypted1).not.toBe(encrypted2);

        const decrypted1 = await decrypt(encrypted1, testUserId);
        const decrypted2 = await decrypt(encrypted2, testUserId);

        expect(decrypted1).toBe(sampleText);
        expect(decrypted2).toBe(sampleText);
    });

    it('should fail to decrypt with wrong userId salt', async () => {
        const encrypted = await encrypt(sampleText, testUserId);
        await expect(decrypt(encrypted, 'wrong-user-id')).rejects.toThrow();
    });

    it('should encrypt and decrypt JSON objects correctly', async () => {
        const payload = { botToken: sampleText, chatId: '987654321', active: true };
        const encryptedJSON = await encryptJSON(payload, testUserId);

        expect(encryptedJSON).toBeDefined();

        const decryptedPayload = await decryptJSON(encryptedJSON, testUserId);
        expect(decryptedPayload).toEqual(payload);
    });

    it('should throw error when decrypting invalid formatted string', async () => {
        await expect(decrypt('invalidformatwithoutcolon', testUserId)).rejects.toThrow();
    });
});
