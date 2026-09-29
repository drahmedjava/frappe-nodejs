import { Controller, Get, Req, Res, Next } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { WebsiteService } from './website.service';

@Controller()
export class WebsiteController {
  constructor(private readonly websiteService: WebsiteService) {}

  @Get()
  async renderHome(@Res() res: Response) {
    const { html, status } = await this.websiteService.renderPage('');
    res.setHeader('Content-Type', 'text/html');
    res.status(status).send(html);
  }

  @Get('{*path}')
  async handleWebRoute(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    const path = req.path;
    // Don't intercept app, api, or websocket routes
    if (path.startsWith('/api') || path.startsWith('/app') || path.startsWith('/socket.io')) {
      return next();
    }

    const route = path.replace(/^\/+/, '');
    const { html, status } = await this.websiteService.renderPage(route);
    res.setHeader('Content-Type', 'text/html');
    res.status(status).send(html);
  }
}
