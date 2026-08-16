import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { USER_ID_HEADER } from './shared/auth/current-user.guard';
import { DomainExceptionFilter } from './shared/http/domain-exception.filter';
import { ResponseEnvelopeInterceptor } from './shared/http/response.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  const apiPrefix = config.get<string>('apiPrefix', 'api/v1');
  const port = config.get<number>('port', 3000);

  app.setGlobalPrefix(apiPrefix);
  app.use(helmet());

  // Declared rather than left to the Express default, so the ceiling on a
  // request body is visible next to the DTO limits that assume it.
  app.useBodyParser('json', { limit: '128kb' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableShutdownHooks();

  // Publishes every route, DTO and header name, including the admin ones.
  if (config.get<string>('env') !== 'production') {
    mountSwagger(app, apiPrefix);
  }

  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`API listening on http://localhost:${port}/${apiPrefix}`);
  logger.log(`Swagger UI at http://localhost:${port}/${apiPrefix}/docs`);
}

function mountSwagger(app: NestExpressApplication, apiPrefix: string): void {
  SwaggerModule.setup(
    `${apiPrefix}/docs`,
    app,
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('AI Chat & Subscription Bundles')
        .setDescription(
          'Mocked AI chat with monthly free quota and stacked subscription bundles. ' +
            `Identify the caller with the '${USER_ID_HEADER}' header.`,
        )
        .setVersion('1.0.0')
        .addApiKey({ type: 'apiKey', name: USER_ID_HEADER, in: 'header' }, USER_ID_HEADER)
        .build(),
    ),
  );
}

bootstrap().catch((error: unknown) => {
  // `void bootstrap()` satisfies the lint rule but attaches no handler, so a
  // failed DB connection or a taken port dies as a bare unhandled rejection
  // with nothing in the application's own log.
  new Logger('Bootstrap').error(
    'Failed to start',
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});
