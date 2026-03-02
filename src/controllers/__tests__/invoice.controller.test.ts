import { describe, it, expect } from 'vitest';
import { overrideProductsCategory, ClassifiedProduct } from '../invoice.controller.js';

describe('invoice.controller - overrideProductsCategory', () => {
    it('should overwrite category if it is "Otros"', () => {
        const products: ClassifiedProduct[] = [
            {
                description: 'Producto desconocido',
                quantity: 1,
                price: 10,
                total: 10,
                category: 'Otros',
                confidence: 80,
                source: 'rules'
            }
        ];
        const result = overrideProductsCategory(products, 'Alimentación', 95);

        expect(result[0].category).toBe('Alimentación');
        expect(result[0].source).toBe('ai');
        expect(result[0].confidence).toBe(95);
    });

    it('should overwrite category if confidence is strictly less than 50', () => {
        const products: ClassifiedProduct[] = [
            {
                description: 'Cepillo',
                quantity: 1,
                price: 5,
                total: 5,
                category: 'Aseo', // Even if it has a category, it's low confidence
                confidence: 49,
                source: 'rules'
            }
        ];
        const result = overrideProductsCategory(products, 'Hogar', 80);

        expect(result[0].category).toBe('Hogar');
        expect(result[0].source).toBe('ai');
        expect(result[0].confidence).toBe(80);
    });

    it('should NOT overwrite if category is valid (not "Otros") and confidence is >= 50', () => {
        const products: ClassifiedProduct[] = [
            {
                description: 'Manzana',
                quantity: 5,
                price: 2,
                total: 10,
                category: 'Alimentación',
                confidence: 50, // Edge case: exactly 50
                source: 'rules'
            }
        ];
        const result = overrideProductsCategory(products, 'Mascotas', 99);

        // It should remain Alimentación
        expect(result[0].category).toBe('Alimentación');
        expect(result[0].source).toBe('rules');
        expect(result[0].confidence).toBe(50);
    });

    it('should handle a mix of products correctly', () => {
        const products: ClassifiedProduct[] = [
            {
                description: 'Manzana',
                quantity: 5,
                price: 2,
                total: 10,
                category: 'Alimentación',
                confidence: 70, // Keep
                source: 'rules'
            },
            {
                description: 'Algo raro',
                quantity: 1,
                price: 20,
                total: 20,
                category: 'Otros', // Overwrite
                confidence: 60,
                source: 'rules'
            },
            {
                description: 'Dudoso',
                quantity: 1,
                price: 5,
                total: 5,
                category: 'Transporte',
                confidence: 30, // Overwrite
                source: 'rules'
            }
        ];

        const result = overrideProductsCategory(products, 'General', 85);

        expect(result).toHaveLength(3);

        // 1st remains
        expect(result[0].category).toBe('Alimentación');
        expect(result[0].source).toBe('rules');

        // 2nd overridden
        expect(result[1].category).toBe('General');
        expect(result[1].source).toBe('ai');
        expect(result[1].confidence).toBe(85);

        // 3rd overridden
        expect(result[2].category).toBe('General');
        expect(result[2].source).toBe('ai');
        expect(result[2].confidence).toBe(85);
    });
});
