import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configuration } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { MetaModule } from './meta/meta.module';
import { DocumentModule } from './document/document.module';
import { AuthModule } from './auth/auth.module';
import { ApiModule } from './api/api.module';
import { AsyncModule } from './async/async.module';
import { LowCodeModule } from './lowcode/lowcode.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    DatabaseModule,
    RedisModule,
    MetaModule,
    DocumentModule,
    AuthModule,
    ApiModule,
    AsyncModule,
    LowCodeModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
