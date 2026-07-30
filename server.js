import './src/config/env.js';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import authRoutes from './src/routes/auth.routes.ts';
import invoiceRoutes from './src/routes/invoice.routes.ts';
import userConfigRoutes from './src/routes/userConfig.routes.js';
import classifierRoutes from './src/routes/classifier.routes.js';
import { errorHandler } from './src/middleware/errorHandler.js';
import logger from './src/utils/logger.js';

const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3001;

// Middleware
const allowedOrigins = [
    'http://localhost:8080',
    'http://localhost:8081',
    'http://localhost:5173',
    'https://andfuentez1.github.io'
];

app.use(cors({
    origin: function (origin, callback) {
        // Permitir peticiones sin origen (como apps móviles o curl)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('.github.io')) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));
app.use(express.json());
app.use(morgan('dev'));

// Rutas
app.use('/auth', authRoutes);
app.use('/api', invoiceRoutes);
app.use('/api/user/config', userConfigRoutes);
app.use('/api/classifier', classifierRoutes);

// Ruta de health check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        service: 'Invoice Processor Backend'
    });
});

// Manejo de errores
app.use(errorHandler);

// Iniciar servidor
app.listen(PORT, () => {
    logger.info(`🚀 Servidor iniciado en puerto ${PORT}`);
    logger.info(`📧 OAuth callback: ${process.env.GMAIL_REDIRECT_URI}`);
    logger.info(`🔐 Environment: ${process.env.NODE_ENV}`);
});

export default app;
