import { Injectable, Logger } from '@nestjs/common';
import { DocumentService } from '../document/document.service';
import { DatabaseService } from '../database/database.service';

export interface WebsiteSettingsData {
  app_name?: string;
  brand_html?: string;
  banner_image?: string;
  favicon?: string;
  copyright?: string;
  custom_css?: string;
  custom_js?: string;
  top_bar_items?: Array<{ label: string; url: string; open_in_new_tab?: boolean }>;
}

export interface WebPageData {
  title: string;
  route: string;
  content_type?: 'HTML' | 'Markdown' | 'Template';
  main_section?: string;
  custom_css?: string;
  custom_js?: string;
  published?: boolean | number;
  show_sidebar?: boolean | number;
}

@Injectable()
export class WebsiteService {
  private readonly logger = new Logger(WebsiteService.name);

  constructor(
    private readonly docService: DocumentService,
    private readonly db: DatabaseService,
  ) {}

  /**
   * Retrieves Website Settings for the active site, or returns smart defaults.
   */
  async getSettings(): Promise<WebsiteSettingsData> {
    try {
      const hasTable = await this.db.hasTable('tabWebsiteSettings');
      if (hasTable) {
        const settingsList = await this.docService.getList('WebsiteSettings', { limit: 1 });
        if (settingsList && settingsList.length > 0) {
          const doc = await this.docService.getDoc('WebsiteSettings', settingsList[0].name);
          const topBarItems = doc.get('top_bar_items') || [];
          return {
            app_name: doc.get('app_name') || 'Frappe NodeJS',
            brand_html: doc.get('brand_html') || `<span class="brand-name">${doc.get('app_name') || 'Frappe NodeJS'}</span>`,
            banner_image: doc.get('banner_image'),
            favicon: doc.get('favicon'),
            copyright: doc.get('copyright') || `© ${new Date().getFullYear()} ${doc.get('app_name') || 'Frappe NodeJS'}. All rights reserved.`,
            custom_css: doc.get('custom_css') || '',
            custom_js: doc.get('custom_js') || '',
            top_bar_items: Array.isArray(topBarItems) && topBarItems.length > 0 ? topBarItems : [
              { label: 'Home', url: '/' },
              { label: 'Desk', url: '/app' },
              { label: 'API Docs', url: '/api/health' },
            ],
          };
        }
      }
    } catch (e: any) {
      this.logger.warn(`Could not load WebsiteSettings from DB: ${e.message}`);
    }

    return {
      app_name: 'Frappe NodeJS',
      brand_html: '<span class="brand-name">⚡ Frappe NodeJS</span>',
      copyright: `© ${new Date().getFullYear()} Frappe NodeJS. All rights reserved.`,
      custom_css: '',
      custom_js: '',
      top_bar_items: [
        { label: 'Home', url: '/' },
        { label: 'Desk', url: '/app' },
        { label: 'API Docs', url: '/api/health' },
      ],
    };
  }

  /**
   * Retrieves a published Web Page by route.
   */
  async getWebPage(route: string): Promise<any | null> {
    try {
      const hasTable = await this.db.hasTable('tabWebPage');
      if (!hasTable) return null;

      const normalized = (route || '').replace(/^\/+|\/+$/g, '');
      const candidates = normalized === '' || normalized === 'home' || normalized === 'index'
        ? ['', 'home', 'index']
        : [normalized];

      for (const candidate of candidates) {
        const pages = await this.docService.getList('WebPage', {
          filters: { route: candidate },
          limit: 1,
        });
        if (pages && pages.length > 0) {
          const pageDoc = await this.docService.getDoc('WebPage', pages[0].name);
          const published = pageDoc.get('published');
          if (published === 1 || published === true || published === undefined) {
            return pageDoc.asJson();
          }
        }
      }
    } catch (e: any) {
      this.logger.warn(`Could not load WebPage for route "${route}": ${e.message}`);
    }
    return null;
  }

  /**
   * Evaluates and renders a custom HTML template with context variable replacement.
   */
  renderTemplate(template: string, context: Record<string, any>): string {
    if (!template) return '';
    return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, key) => {
      const parts = key.split('.');
      let val: any = context;
      for (const part of parts) {
        if (val !== undefined && val !== null) {
          val = val[part];
        } else {
          return '';
        }
      }
      return val !== undefined && val !== null ? String(val) : '';
    });
  }

  /**
   * Builds the complete HTML document for a WebPage or default landing page.
   */
  async renderPage(route: string, context: Record<string, any> = {}): Promise<{ html: string; status: number }> {
    const settings = await this.getSettings();
    const page = await this.getWebPage(route);

    const mergedContext = {
      site_name: settings.app_name || 'Frappe NodeJS',
      app_name: settings.app_name || 'Frappe NodeJS',
      copyright: settings.copyright,
      current_year: new Date().getFullYear(),
      title: page ? page.title : settings.app_name || 'Frappe NodeJS',
      ...context,
    };

    let bodyContent = '';
    let pageTitle = settings.app_name || 'Frappe NodeJS';
    let pageCss = '';
    let pageJs = '';
    let status = 200;

    const normalized = (route || '').replace(/^\/+|\/+$/g, '');
    const isHome = normalized === '' || normalized === 'home' || normalized === 'index';

    if (page) {
      pageTitle = `${page.title} — ${settings.app_name}`;
      pageCss = page.custom_css || '';
      pageJs = page.custom_js || '';
      bodyContent = this.renderTemplate(page.main_section || '', mergedContext);
    } else if (isHome) {
      bodyContent = this.getDefaultLandingHtml(settings);
    } else {
      return {
        html: this.render404(normalized, settings),
        status: 404,
      };
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  ${settings.favicon ? `<link rel="icon" href="${settings.favicon}">` : ''}
  <style>
    :root {
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --text: #0f172a;
      --text-muted: #64748b;
      --border: #e2e8f0;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      line-height: 1.6;
    }
    .navbar {
      background: var(--card-bg);
      border-bottom: 1px solid var(--border);
      padding: 0.75rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text);
      text-decoration: none;
    }
    .nav-links {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      list-style: none;
    }
    .nav-links a {
      color: var(--text-muted);
      text-decoration: none;
      font-weight: 500;
      transition: color 0.15s;
    }
    .nav-links a:hover {
      color: var(--primary);
    }
    .btn-desk {
      background: var(--primary);
      color: #fff !important;
      padding: 0.4rem 1rem;
      border-radius: 6px;
      font-weight: 600;
    }
    .btn-desk:hover {
      background: var(--primary-hover);
    }
    .main-container {
      flex: 1;
      padding: 2.5rem 2rem;
      max-width: 1200px;
      width: 100%;
      margin: 0 auto;
    }
    .footer {
      background: var(--card-bg);
      border-top: 1px solid var(--border);
      padding: 1.5rem 2rem;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.875rem;
    }
    ${settings.custom_css || ''}
    ${pageCss}
  </style>
</head>
<body>
  <nav class="navbar">
    <a href="/" class="brand">${settings.brand_html || settings.app_name}</a>
    <ul class="nav-links">
      ${(settings.top_bar_items || []).map((item: any) => `
        <li><a href="${item.url}" ${item.open_in_new_tab ? 'target="_blank"' : ''}>${item.label}</a></li>
      `).join('')}
    </ul>
  </nav>

  <main class="main-container">
    ${bodyContent}
  </main>

  <footer class="footer">
    <p>${settings.copyright}</p>
  </footer>

  <script>
    ${settings.custom_js || ''}
    ${pageJs}
  </script>
</body>
</html>`;

    return { html, status };
  }

  private getDefaultLandingHtml(settings: WebsiteSettingsData): string {
    return `
      <section style="text-align: center; padding: 4rem 1rem;">
        <h1 style="font-size: 3rem; font-weight: 800; margin-bottom: 1rem; color: #1e293b;">
          Welcome to ${settings.app_name || 'Frappe NodeJS'}
        </h1>
        <p style="font-size: 1.25rem; color: #64748b; max-width: 650px; margin: 0 auto 2rem auto;">
          The enterprise-grade Node.js/NestJS runtime for Frappe Framework — featuring multi-site tenancy, metadata schemas, real-time sync, and customizable views.
        </p>
        <div style="display: flex; gap: 1rem; justify-content: center;">
          <a href="/app" style="background: #2563eb; color: #fff; padding: 0.75rem 1.75rem; border-radius: 8px; text-decoration: none; font-weight: 600; box-shadow: 0 4px 6px -1px rgba(37,99,235,0.2);">Go to Desk</a>
          <a href="/api/health" style="background: #f1f5f9; color: #334155; padding: 0.75rem 1.75rem; border-radius: 8px; text-decoration: none; font-weight: 600; border: 1px solid #cbd5e1;">API Health</a>
        </div>
      </section>
    `;
  }

  private render404(route: string, settings: WebsiteSettingsData): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Page Not Found — 404</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #f8fafc; color: #1e293b; display: flex; align-items: center; justify-content: center; min-height: 100vh; text-align: center; margin: 0; }
    .box { background: #fff; padding: 3rem; border-radius: 12px; border: 1px solid #e2e8f0; max-width: 450px; }
    h1 { font-size: 4rem; color: #ef4444; margin: 0; }
    p { color: #64748b; margin: 1rem 0 2rem; }
    a { background: #2563eb; color: #fff; text-decoration: none; padding: 0.6rem 1.2rem; border-radius: 6px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="box">
    <h1>404</h1>
    <h2>Page Not Found</h2>
    <p>The requested page <code>/${route}</code> does not exist.</p>
    <a href="/">Return Home</a>
  </div>
</body>
</html>`;
  }
}
