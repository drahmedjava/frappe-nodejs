import { Global, Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PermissionService } from './permission.service';
import { UserPermissionService } from './user-permission.service';
import { AuthMiddleware } from './auth.middleware';

@Global()
@Module({
  providers: [AuthService, PermissionService, UserPermissionService, AuthMiddleware],
  exports: [AuthService, PermissionService, UserPermissionService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes('*');
  }
}
