import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { RealtimeService } from './async/realtime.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Enable CORS similar to Frappe
  app.enableCors();

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port') || 3000;

  const server = await app.listen(port);
  const realtimeService = app.get(RealtimeService);
  realtimeService.attach(app.getHttpServer());

  logger.log(`Frappe Node.js backend listening on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
