export class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

export class ValidationError extends AppError {
    constructor(message) {
        super(message, 400);
    }
}

export class AuthenticationError extends AppError {
    constructor(message = 'No autenticado') {
        super(message, 401);
    }
}

export class NotFoundError extends AppError {
    constructor(message = 'Recurso no encontrado') {
        super(message, 404);
    }
}
