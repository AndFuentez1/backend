import winston from 'winston';

const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    ),
    defaultMeta: { service: 'invoice-processor' },
    transports: [
        // Escribir logs de error a archivo
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        // Escribir todos los logs a archivo
        new winston.transports.File({ filename: 'logs/combined.log' }),
    ],
});

// Si no estamos en producción, también log a consola
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        ),
    }));
}

export default logger;
