import logger from '../utils/logger.js';
import { translateErrorMessage } from '../utils/errorTranslator.ts';

export const errorHandler = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    const translatedMessage = translateErrorMessage(err.message);

    // Log del error con mensaje traducido
    logger.error({
        message: translatedMessage,
        originalMessage: err.message,
        stack: err.stack,
        statusCode: err.statusCode,
        path: req.path,
        method: req.method,
    });

    // Respuesta al cliente
    if (process.env.NODE_ENV === 'development') {
        res.status(err.statusCode).json({
            status: err.status,
            error: err,
            message: translatedMessage,
            stack: err.stack,
        });
    } else {
        // En producción, no enviar detalles internos
        if (err.isOperational) {
            res.status(err.statusCode).json({
                status: err.status,
                message: translatedMessage,
            });
        } else {
            // Error de programación o desconocido
            res.status(500).json({
                status: 'error',
                message: 'Algo salió mal',
            });
        }
    }
};
