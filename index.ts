import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import cluster from 'cluster';
import fs from 'fs';
import os from 'os';
import compression from 'compression';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './src/swagger/swagger.config';
import sqlRouter, { sqlDatabaseConnection } from './src/sql_module';
import mongoDbRouter, { mongodbConnection } from './src/mongo_module/modules';
import HttpException from './src/common/http.Exception/http.Exception';
import mongoose from 'mongoose';
import {
  globalErrorHandler,
  handleErrorForResponse,
  notFoundHandler,
  requestIdMiddleware,
} from './src/common/middleware/api-error.middleware';
dotenv.config();

/**
 * CPUs this container may actually use. os.cpus() reports the *host's* cores
 * inside a container, so a pod limited to 2 vCPU on a 32-core node would fork
 * 32 workers, each with its own MongoDB pool. WORKERS env var overrides.
 */
function workerCount(): number {
  const fromEnv = parseInt(process.env.WORKERS ?? '', 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  try {
    const [quota, period] = fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/);
    if (quota !== 'max') return Math.max(1, Math.floor(Number(quota) / Number(period)));
  } catch { /* not cgroup v2 */ }
  try {
    const quota = Number(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8'));
    const period = Number(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8'));
    if (quota > 0 && period > 0) return Math.max(1, Math.floor(quota / period));
  } catch { /* not cgroup v1 */ }
  return os.cpus().length || 1;
}

const numCPUs = workerCount();

if (cluster.isPrimary) {
  console.log(`Master ${process.pid} is running`);

  // Fork workers
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker) => {
    console.log(`Worker ${worker.process.pid} died`);
    console.log('Starting a new worker');
    cluster.fork();
  });
} else {
  (async () => {
    
    const app = express();
    const PORT: number = parseInt(process.env.PORT || '3009');
    const HOST: string = '0.0.0.0';
    const dataBaseType: string = process.env.DATABASE_TYPE || '';
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
    const appVersion =  process.env.APP_VERSION || 'All'

    app.use(requestIdMiddleware);

    app.use((_req, res, next) => {
      res.setHeader('x-app-version', appVersion);
      next();
    });

    // Increase request size limit
    app.use(express.json({ limit: '5mb' }));
    app.use(express.urlencoded({ limit: '5mb', extended: true }));

    app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (err instanceof SyntaxError && 'body' in err) {
        return handleErrorForResponse(
          res,
          req,
          new HttpException(400, 'Invalid JSON format in request body', {
            errorType: 'BadRequest',
            code: 'INVALID_JSON',
          }),
        );
      }
      next(err);
    });

    // Cors aalowd for the specific url
    app.use(
      cors({
        origin: (origin, callback) => {
          if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
          } else {
            console.log("allowed origins", allowedOrigins)
            callback(new Error('Not allowed by CORS' + origin));
          }
        },
        credentials: true,
      }),
    );

    // compress the response
    app.use(compression());

    // Swagger API Documentation
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
      explorer: true,
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'All Orchestration Service API Docs'
    }));

    // Swagger JSON endpoint
    app.get('/api-docs.json', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(swaggerSpec);
    });

    try {
      if (dataBaseType.toLowerCase() === 'mysql') {
        await sqlDatabaseConnection();
        app.use('/api', sqlRouter);
      } else {
        await mongodbConnection();
        app.use('/api', mongoDbRouter);
      }
    } catch (dbError) {
      console.error('Database startup failed. Shutting down worker.', dbError);
      throw dbError;
    }

    // App testing
    app.get('/ping', (req, res) => {
      res.status(200).json({
        status: true,
        message: 'App is working',
      });
    });

    // Deep health check
    app.get('/health', (req, res) => {
      const mongoOk = dataBaseType.toLowerCase() !== 'mysql'
        ? mongoose.connection.readyState === 1
        : null;
      const allOk = mongoOk !== false;
      res.status(200).json({
        status: allOk ? 'ok' : 'degraded',
        services: {
          ...(mongoOk !== null && { mongodb: mongoOk }),
        },
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
    });

    app.use(notFoundHandler);
    app.use(globalErrorHandler);

    const server = app.listen(PORT, HOST, () => {
      console.log(`Worker ${process.pid} is running on port ${PORT}`);
    });
    // Node's default keep-alive timeout is 5 s. The gateway in front keeps idle
    // upstream connections longer, so it can send a request on a socket this
    // server is closing at that moment -> intermittent 502 Bad Gateway.
    // Must be longer than the gateway's idle timeout (override per env).
    server.keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT_MS || '', 10) || 65000;
    server.headersTimeout = server.keepAliveTimeout + 1000;
  })();

}
