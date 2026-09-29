import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

@Controller('app')
export class DeskController {
  private deskHtml: string | null = null;

  private getHtml(): string {
    if (!this.deskHtml) {
      const candidates = [
        path.join(__dirname, 'desk.html'),
        path.join(process.cwd(), 'src', 'desk', 'desk.html'),
        path.join(process.cwd(), 'dist', 'desk', 'desk.html'),
      ];

      for (const p of candidates) {
        if (fs.existsSync(p)) {
          this.deskHtml = fs.readFileSync(p, 'utf-8');
          break;
        }
      }

      if (!this.deskHtml) {
        this.deskHtml = '<h1>Frappe Desk HTML not found</h1>';
      }
    }
    return this.deskHtml;
  }

  @Get()
  renderDesk(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/html');
    res.send(this.getHtml());
  }

  @Get('{*path}')
  renderDeskRoute(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/html');
    res.send(this.getHtml());
  }
}
