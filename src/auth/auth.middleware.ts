import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private readonly authService: AuthService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'] as string | undefined;
    const userHeader = req.headers['x-frappe-user'] as string | undefined;

    (req as any).authUser = await this.authService.resolveUser(authHeader, userHeader);
    next();
  }
}
