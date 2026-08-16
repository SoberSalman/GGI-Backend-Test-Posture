import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { USER_ID_HEADER } from './shared/auth/current-user.guard';
import { DomainExceptionFilter } from './shared/http/domain-exception.filter';
import { ResponseEnvelopeInterceptor } from './shared/http/response.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  const apiPrefix = config.get<string>('apiPrefix', 'api/v1');
  const port = config.get<number>('port', 3000);

  app.setGlobalPrefix(apiPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties the DTO does not declare
      forbidNonWhitelisted: true, // ...and reject the request that sent them
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableShutdownHooks();

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

  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`API listening on http://localhost:${port}/${apiPrefix}`);
  logger.log(`Swagger UI at http://localhost:${port}/${apiPrefix}/docs`);
}

void bootstrap();
