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
import { DeskModule } from './desk/desk.module';
import { PeripheralModule } from './peripheral/peripheral.module';
import { TenantModule } from './tenant/tenant.module';
import { WebsiteModule } from './website/website.module';
import { CoreModule } from './core/core.module';
import { TaskModule } from './modules/task/task.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    TenantModule,
    DatabaseModule,
    RedisModule,
    MetaModule,
    DocumentModule,
    AuthModule,
    ApiModule,
    AsyncModule,
    LowCodeModule,
    DeskModule,
    PeripheralModule,
    WebsiteModule,
    CoreModule,
    TaskModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
