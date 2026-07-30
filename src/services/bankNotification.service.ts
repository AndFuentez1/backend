export type BankTransferDirection = 'outgoing' | 'incoming' | 'unknown';

export interface BankNotification {
    bank: string;
    amount: number;
    date: string | null;
    description: string;
    kind: 'transfer';
    direction: BankTransferDirection;
    sourceAccount: string | null;
    destinationAccount: string | null;
}

interface BankConfig {
    id: string;
    domain: string;
    keywords: string[];
    parse: (subject: string, bodyText: string) => BankNotification | null;
}

const decodeQuotedPrintable = (input: string): string => {
    if (!input) {
        return '';
    }

    const softBreaksRemoved = input.replace(/=\r?\n/g, '');
    return softBreaksRemoved.replace(/=([A-Fa-f0-9]{2})/g, (_match, hex: string) => {
        const code = Number.parseInt(hex, 16);
        return Number.isNaN(code) ? '' : String.fromCharCode(code);
    });
};

const stripHtml = (input: string): string =>
    input
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&');

const normalizeText = (input: string): string =>
    stripHtml(decodeQuotedPrintable(input))
        .replace(/\s+/g, ' ')
        .trim();

const parseAmount = (rawAmount: string): number | null => {
    const value = (rawAmount || '').trim();
    if (!value) {
        return null;
    }

    const hasComma = value.includes(',');
    const hasDot = value.includes('.');
    let normalized = value;

    if (hasComma && hasDot) {
        if (value.lastIndexOf(',') > value.lastIndexOf('.')) {
            normalized = value.replace(/\./g, '').replace(/,/g, '.');
        } else {
            normalized = value.replace(/,/g, '');
        }
    } else if (hasComma && !hasDot) {
        const lastComma = value.lastIndexOf(',');
        const decimalLength = value.length - lastComma - 1;
        normalized = decimalLength === 3
            ? value.replace(/,/g, '')
            : value.replace(/,/g, '.');
    } else if (hasDot && !hasComma) {
        const lastDot = value.lastIndexOf('.');
        const decimalLength = value.length - lastDot - 1;
        normalized = decimalLength === 3
            ? value.replace(/\./g, '')
            : value;
    }

    const amount = Number.parseFloat(normalized);
    if (!Number.isFinite(amount) || amount <= 0) {
        return null;
    }

    return amount;
};

const toIsoDate = (year: string, month: string, day: string, time?: string): string => {
    if (!time) {
        return `${year}-${month}-${day}T00:00:00`;
    }

    const [rawHour, rawMinute] = time.split(':');
    const hour = String(rawHour || '00').padStart(2, '0');
    const minute = String(rawMinute || '00').padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:${minute}:00`;
};

const parseNotificationDate = (normalizedText: string): string | null => {
    const dayFirstMatch = normalizedText.match(/\b(\d{2})[\/\-](\d{2})[\/\-](\d{4})(?:\s*(?:a\s*las)?\s*(\d{1,2}:\d{2}))?/i);
    if (dayFirstMatch) {
        const [, day, month, year, time] = dayFirstMatch;
        return toIsoDate(year, month, day, time);
    }

    const yearFirstMatch = normalizedText.match(/\b(\d{4})[\/\-](\d{2})[\/\-](\d{2})(?:\s*(?:a\s*las)?\s*(\d{1,2}:\d{2}))?/i);
    if (yearFirstMatch) {
        const [, year, month, day, time] = yearFirstMatch;
        return toIsoDate(year, month, day, time);
    }

    return null;
};

const inferDirection = (normalizedText: string): BankTransferDirection => {
    const text = normalizedText.toLowerCase();
    if (/\b(transferiste|enviaste|envi\u00f3)\b/i.test(text)) {
        return 'outgoing';
    }
    if (/\b(recibiste|te\s+transfirieron|te\s+enviaron)\b/i.test(text)) {
        return 'incoming';
    }
    return 'unknown';
};

const sanitizeAccount = (account: string | null | undefined): string | null =>
    account ? account.trim().replace(/\s+/g, '') : null;

const parseBancolombiaTransfer = (_subject: string, bodyText: string): BankNotification | null => {
    const normalizedText = normalizeText(bodyText);
    if (!normalizedText) {
        return null;
    }

    if (!/\b(transferiste|recibiste|transferencia|movimientos)\b/i.test(normalizedText)) {
        return null;
    }

    const amountMatch = normalizedText.match(/\$\s*([\d.,]+)/);
    const amount = amountMatch ? parseAmount(amountMatch[1]) : null;
    if (!amount) {
        return null;
    }

    const direction = inferDirection(normalizedText);
    const sourceMatch = normalizedText.match(/desde\s+(?:tu\s+)?cuenta\s+(\*+\d{2,}|\d{4,})/i);
    const destinationMatch = normalizedText.match(/(?:a|en)\s+(?:la\s+)?cuenta\s+(\*+\d{2,}|\d{4,})/i);
    const maskedAccounts = normalizedText.match(/\*+\d{2,}/g) || [];

    let sourceAccount = sanitizeAccount(sourceMatch?.[1]);
    let destinationAccount = sanitizeAccount(destinationMatch?.[1]);

    if (!sourceAccount && maskedAccounts.length > 0) {
        sourceAccount = sanitizeAccount(maskedAccounts[0]);
    }
    if (!destinationAccount && maskedAccounts.length > 1) {
        destinationAccount = sanitizeAccount(maskedAccounts[1]);
    }

    if (direction === 'incoming' && sourceAccount === destinationAccount && maskedAccounts.length > 1) {
        sourceAccount = sanitizeAccount(maskedAccounts[0]);
        destinationAccount = sanitizeAccount(maskedAccounts[1]);
    }

    const transferLabel = direction === 'outgoing'
        ? 'Transferencia de salida'
        : direction === 'incoming'
            ? 'Transferencia de entrada'
            : 'Transferencia bancaria';
    const accountHint = direction === 'outgoing'
        ? (destinationAccount || sourceAccount)
        : (sourceAccount || destinationAccount);
    const description = accountHint ? `${transferLabel} ${accountHint}` : transferLabel;

    return {
        bank: 'Bancolombia',
        amount,
        date: parseNotificationDate(normalizedText),
        description,
        kind: 'transfer',
        direction,
        sourceAccount,
        destinationAccount
    };
};

export const BANK_CONFIGS: BankConfig[] = [
    {
        id: 'bancolombia_transfer',
        domain: 'notificacionesbancolombia.com',
        keywords: ['Transferiste', 'Recibiste', 'movimientos', 'Transferencia'],
        parse: parseBancolombiaTransfer
    }
];

export const getBankNotificationQuery = (): string => {
    return BANK_CONFIGS.map((bank) => {
        const keywords = bank.keywords.map((keyword) => `"${keyword}"`).join(' OR ');
        return `from:${bank.domain} (${keywords})`;
    }).join(' OR ');
};

export const parseBankNotification = (from: string, subject: string, bodyText: string): BankNotification | null => {
    const normalizedFrom = (from || '').toLowerCase();
    for (const config of BANK_CONFIGS) {
        if (normalizedFrom.includes(config.domain.toLowerCase()) || normalizedFrom.includes('bancolombia')) {
            const result = config.parse(subject, bodyText);
            if (result) {
                return result;
            }
        }
    }
    return null;
};
