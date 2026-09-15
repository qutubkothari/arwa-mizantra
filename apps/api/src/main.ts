import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
import { static as serveStatic } from 'express';
import { existsSync, mkdirSync, statSync } from 'fs';
import { resolve } from 'path';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { NoFutureDatesPipe } from './common/pipes/no-future-dates.pipe';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
    rawBody: true,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('APP_PORT', 4000);
  const companyName = configService.get<string>('COMPANY_NAME', 'Manufacturing');

  // Body size limits (needed for base64 document uploads)
  const bodySizeLimit = configService.get<string>('BODY_SIZE_LIMIT', '50mb');

  // Security
  app.use(helmet());
  
  // CORS - allow both localhost and production frontend
  const corsOrigins = configService.get('CORS_ORIGIN', 'http://localhost:3000').split(',');
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  // Compression
  app.use(compression());

  // Increase request payload limits (default is too small for base64 PDFs/images)
  app.useBodyParser('json', { limit: bodySizeLimit });
  app.useBodyParser('urlencoded', { extended: true, limit: bodySizeLimit });

  // Serve uploaded files (local EC2 storage)
  const uploadsRoot =
    configService.get<string>('UPLOAD_ROOT_DIR') ||
    resolve(process.cwd(), '..', '..', 'uploads');
  mkdirSync(uploadsRoot, { recursive: true });
  app.use('/uploads', serveStatic(uploadsRoot));

  // PMSTest can contain GRN records copied from live while the physical files
  // still sit in the live upload directory. Serve configured fallback roots
  // after the primary upload root, without changing saved invoice URLs.
  const configuredUploadFallbacks = configService
    .get<string>('UPLOAD_FALLBACK_DIRS', '')
    .split(',')
    .map((dir) => dir.trim())
    .filter(Boolean);
  const inferredLiveUploadRoot = uploadsRoot.includes('/sak-erp-test/uploads')
    ? uploadsRoot.replace('/sak-erp-test/uploads', '/sak-erp/uploads')
    : '';
  const uploadFallbackRoots = Array.from(
    new Set([...configuredUploadFallbacks, inferredLiveUploadRoot].filter(Boolean)),
  );

  app.use('/uploads', (req, res, next) => {
    const requestPath = decodeURIComponent(String(req.path || ''));
    for (const root of uploadFallbackRoots) {
      const resolvedRoot = resolve(root);
      const candidate = resolve(resolvedRoot, `.${requestPath}`);
      if (!candidate.startsWith(resolvedRoot) || !existsSync(candidate)) continue;
      try {
        if (statSync(candidate).isFile()) {
          res.sendFile(candidate);
          return;
        }
      } catch {
        // Try the next fallback root.
      }
    }
    next();
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
    new NoFutureDatesPipe(),
  );

  // API prefix
  app.setGlobalPrefix('api/v1');

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle(`${companyName} ERP API`)
    .setDescription(
      'Comprehensive API for multi-tenant, multi-plant manufacturing ERP system',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Authentication')
    .addTag('Tenants')
    .addTag('Users')
    .addTag('Purchase')
    .addTag('Inventory')
    .addTag('Production')
    .addTag('Sales')
    .addTag('Service')
    .addTag('Workflow')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // Bind to 0.0.0.0 for EC2 compatibility
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 API Server running on: http://localhost:${port}`);
  console.log(`📚 API Documentation: http://localhost:${port}/api/docs`);
  console.log(`🎯 GraphQL Playground: http://localhost:${port}/graphql`);
}

bootstrap();
