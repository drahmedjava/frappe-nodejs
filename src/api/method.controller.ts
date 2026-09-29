import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UnauthorizedException,
} from '@nestjs/common';
import { MethodRegistryService } from './method-registry.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';

@Controller('api/method')
export class MethodController {
  constructor(private readonly methodRegistry: MethodRegistryService) {}

  @Get(':methodName')
  async handleGet(
    @Param('methodName') methodName: string,
    @Query() query: Record<string, any>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.execute(methodName, query, user);
  }

  @Post(':methodName')
  async handlePost(
    @Param('methodName') methodName: string,
    @Body() body: Record<string, any>,
    @Query() query: Record<string, any>,
    @CurrentUser() user: AuthUser,
  ) {
    const params = { ...query, ...body };
    return this.execute(methodName, params, user);
  }

  private async execute(methodName: string, params: Record<string, any>, user: AuthUser) {
    const { handler, options } = this.methodRegistry.get(methodName);

    if (!options.isPublic && user.isGuest) {
      throw new UnauthorizedException(`Login required to execute method "${methodName}"`);
    }

    const result = await handler(params, { user });
    return { message: result };
  }
}
