import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { SiteResolverService } from './site-resolver.service';
import { SiteContextService } from './site-context.service';

@Injectable()
export class SiteStorageService {
  private readonly logger = new Logger(SiteStorageService.name);

  constructor(
    private readonly siteResolver: SiteResolverService,
    private readonly siteContext: SiteContextService,
  ) {}

  /**
   * Resolves the active site name from parameter or current AsyncLocalStorage context.
   */
  private resolveSiteName(site?: string): string {
    const s = site || this.siteContext.getCurrentSite();
    if (!s) {
      throw new Error('No active site context found for storage operation');
    }
    return s;
  }

  getPublicFilesDir(site?: string): string {
    const siteName = this.resolveSiteName(site);
    const dir = path.join(this.siteResolver.getSitePath(siteName), 'public', 'files');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  getPrivateFilesDir(site?: string): string {
    const siteName = this.resolveSiteName(site);
    const dir = path.join(this.siteResolver.getSitePath(siteName), 'private', 'files');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  async saveFile(
    filename: string,
    content: Buffer | string,
    isPrivate = false,
    site?: string,
  ): Promise<{ filename: string; fileUrl: string; filePath: string }> {
    const dir = isPrivate ? this.getPrivateFilesDir(site) : this.getPublicFilesDir(site);
    const safeFilename = path.basename(filename);
    const filePath = path.join(dir, safeFilename);

    await fs.promises.writeFile(filePath, content);

    const siteName = this.resolveSiteName(site);
    const fileUrl = isPrivate
      ? `/api/method/frappe.core.doctype.file.download?file_name=${encodeURIComponent(safeFilename)}`
      : `/files/${encodeURIComponent(safeFilename)}`;

    this.logger.log(`Saved file [${safeFilename}] for site [${siteName}]`);

    return {
      filename: safeFilename,
      fileUrl,
      filePath,
    };
  }

  async getFile(filename: string, isPrivate = false, site?: string): Promise<Buffer | null> {
    const dir = isPrivate ? this.getPrivateFilesDir(site) : this.getPublicFilesDir(site);
    const safeFilename = path.basename(filename);
    const filePath = path.join(dir, safeFilename);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    return fs.promises.readFile(filePath);
  }

  async deleteFile(filename: string, isPrivate = false, site?: string): Promise<boolean> {
    const dir = isPrivate ? this.getPrivateFilesDir(site) : this.getPublicFilesDir(site);
    const safeFilename = path.basename(filename);
    const filePath = path.join(dir, safeFilename);

    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      return true;
    }
    return false;
  }

  listFiles(isPrivate = false, site?: string): string[] {
    const dir = isPrivate ? this.getPrivateFilesDir(site) : this.getPublicFilesDir(site);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir);
  }
}
