import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DocumentService } from '../src/document/document.service';
import { SchemaSyncService } from '../src/meta/schema-sync.service';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { SiteManagerService } from '../src/tenant/site-manager.service';
import { SiteContextService } from '../src/tenant/site-context.service';
import { SiteResolverService } from '../src/tenant/site-resolver.service';

describe('Custom HTML Views & Main Site (Public Portal, WebPage, WebsiteSettings, CustomHTMLBlock)', () => {
  let app: INestApplication;
  let docService: DocumentService;
  let schemaSync: SchemaSyncService;
  let siteManager: SiteManagerService;
  let siteContext: SiteContextService;
  let siteResolver: SiteResolverService;
  const testSitesDir = path.join(os.tmpdir(), 'frappe-html-test-sites-' + Date.now());

  beforeAll(async () => {
    process.env.DB_CLIENT = 'sqlite3';
    process.env.DB_FILENAME = ':memory:';
    process.env.REDIS_ENABLED = 'false';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    docService = moduleRef.get<DocumentService>(DocumentService);
    schemaSync = moduleRef.get<SchemaSyncService>(SchemaSyncService);
    siteManager = moduleRef.get<SiteManagerService>(SiteManagerService);
    siteContext = moduleRef.get<SiteContextService>(SiteContextService);
    siteResolver = moduleRef.get<SiteResolverService>(SiteResolverService);

    siteResolver.setSitesPath(testSitesDir);

    // Sync all DocTypes including WebPage, WebsiteSettings, CustomHTMLBlock, etc.
    await schemaSync.syncAll();
  });

  afterAll(async () => {
    await app.close();
    if (fs.existsSync(testSitesDir)) {
      fs.rmSync(testSitesDir, { recursive: true, force: true });
    }
  });

  describe('1. Default Main Site Landing Page', () => {
    it('GET / - should render default landing page with 200 OK when no homepage WebPage exists', async () => {
      const res = await request(app.getHttpServer())
        .get('/')
        .expect(200)
        .expect('Content-Type', /text\/html/);

      expect(res.text).toContain('Welcome to Frappe NodeJS');
      expect(res.text).toContain('Go to Desk');
      expect(res.text).toContain('/app');
      expect(res.text).toContain('API Health');
    });

    it('GET /non-existent-route - should return 404 Page Not Found', async () => {
      const res = await request(app.getHttpServer())
        .get('/non-existent-route')
        .expect(404)
        .expect('Content-Type', /text\/html/);

      expect(res.text).toContain('404');
      expect(res.text).toContain('Page Not Found');
      expect(res.text).toContain('non-existent-route');
    });
  });

  describe('2. Custom WebPage Routing and HTML Customization', () => {
    it('should create a custom WebPage for /about and serve it with custom HTML & CSS', async () => {
      const aboutPage = docService.newDoc('WebPage', {
        title: 'About Our Platform',
        route: 'about',
        content_type: 'HTML',
        main_section: `
          <div class="about-hero">
            <h1>About Our Modern Platform</h1>
            <p>Built with Frappe NodeJS architecture for enterprise scalability.</p>
          </div>
        `,
        custom_css: '.about-hero { background: #eff6ff; padding: 20px; border-radius: 8px; }',
        custom_js: 'console.log("About page loaded");',
        published: 1,
      });
      await aboutPage.insert();

      const res = await request(app.getHttpServer())
        .get('/about')
        .expect(200)
        .expect('Content-Type', /text\/html/);

      expect(res.text).toContain('About Our Modern Platform');
      expect(res.text).toContain('Built with Frappe NodeJS architecture');
      expect(res.text).toContain('.about-hero { background: #eff6ff;');
      expect(res.text).toContain('About page loaded');
    });

    it('should support dynamic context template variables in WebPage (e.g. {{ site_name }})', async () => {
      const pricingPage = docService.newDoc('WebPage', {
        title: 'Platform Pricing',
        route: 'pricing',
        content_type: 'HTML',
        main_section: `
          <section>
            <h2>Plans for {{ site_name }}</h2>
            <p>Copyright {{ current_year }}</p>
          </section>
        `,
        published: 1,
      });
      await pricingPage.insert();

      const res = await request(app.getHttpServer())
        .get('/pricing')
        .expect(200);

      expect(res.text).toContain('Plans for Frappe NodeJS');
      expect(res.text).toContain(`Copyright ${new Date().getFullYear()}`);
    });

    it('should override the main site homepage (GET /) when a WebPage with route "home" exists', async () => {
      const homePage = docService.newDoc('WebPage', {
        title: 'Custom Enterprise Portal',
        route: 'home',
        content_type: 'HTML',
        main_section: `
          <div class="custom-home">
            <h1>🚀 Welcome to Enterprise Portal</h1>
            <p>Tailored custom homepage experience.</p>
          </div>
        `,
        published: 1,
      });
      await homePage.insert();

      const res = await request(app.getHttpServer())
        .get('/')
        .expect(200);

      expect(res.text).toContain('Welcome to Enterprise Portal');
      expect(res.text).toContain('Tailored custom homepage experience.');
    });
  });

  describe('3. WebsiteSettings Customization (Branding, Custom Head/CSS, Top Bar Navigation)', () => {
    it('should update WebsiteSettings and inject brand HTML, navbar items, and global CSS', async () => {
      const settings = docService.newDoc('WebsiteSettings', {
        name: 'Website Settings',
        app_name: 'Acme Cloud Platform',
        brand_html: '<span class="acme-logo">⭐ Acme Cloud</span>',
        copyright: '© 2026 Acme Corp. Built on Frappe NodeJS.',
        custom_css: 'body { font-family: "Fira Code", monospace; } .acme-logo { color: #f59e0b; }',
        top_bar_items: [
          { label: 'Products', url: '/pricing' },
          { label: 'Company', url: '/about' },
          { label: 'Desk Console', url: '/app' },
        ],
      });
      await settings.insert();

      // Verify public site reflects WebsiteSettings
      const res = await request(app.getHttpServer())
        .get('/about')
        .expect(200);

      expect(res.text).toContain('⭐ Acme Cloud');
      expect(res.text).toContain('Products');
      expect(res.text).toContain('Desk Console');
      expect(res.text).toContain('© 2026 Acme Corp.');
      expect(res.text).toContain('.acme-logo { color: #f59e0b; }');
    });

    it('GET /api/method/frappe.website.get_settings - should return settings via RPC', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/method/frappe.website.get_settings')
        .expect(200);

      expect(res.body.message.app_name).toBe('Acme Cloud Platform');
      expect(res.body.message.top_bar_items.length).toBeGreaterThan(0);
    });

    it('POST /api/method/frappe.website.render_template - should render template string with context', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/method/frappe.website.render_template')
        .send({
          template: '<div class="alert">Hello {{ user.name }}, you have {{ count }} tasks!</div>',
          context: { user: { name: 'Alice' }, count: 5 },
        })
        .expect(201);

      expect(res.body.message).toBe('<div class="alert">Hello Alice, you have 5 tasks!</div>');
    });
  });

  describe('4. Custom Views HTML: CustomHTMLBlock and Kanban/Card HTML Templates', () => {
    it('should create and retrieve a CustomHTMLBlock for DocType views', async () => {
      const htmlBlock = docService.newDoc('CustomHTMLBlock', {
        block_name: 'TaskMetricsBanner',
        reference_doctype: 'Task',
        html: '<div class="task-banner"><span class="pulse">⚡</span> Live Sprint Progress Tracker</div>',
        style: '.task-banner { background: #dbeafe; padding: 12px; font-weight: bold; }',
        is_active: 1,
      });
      await htmlBlock.insert();

      const res = await request(app.getHttpServer())
        .get('/api/method/frappe.views.get_custom_html_blocks?doctype=Task')
        .expect(200);

      expect(res.body.message.length).toBeGreaterThanOrEqual(1);
      const bannerBlock = res.body.message.find((b: any) => b.block_name === 'TaskMetricsBanner');
      expect(bannerBlock).toBeDefined();
      expect(bannerBlock.html).toContain('Live Sprint Progress Tracker');

      // Also verify get_views introspection returns custom_html_blocks
      const viewsRes = await request(app.getHttpServer())
        .get('/api/method/frappe.views.get_views?doctype=Task')
        .expect(200);

      expect(viewsRes.body.message.custom_html_blocks.length).toBeGreaterThanOrEqual(1);
      const viewBannerBlock = viewsRes.body.message.custom_html_blocks.find((b: any) => b.block_name === 'TaskMetricsBanner');
      expect(viewBannerBlock).toBeDefined();
    });

    it('should support custom card_template HTML on KanbanBoard', async () => {
      const customCardHtml = `
        <div class="custom-kanban-card">
          <div class="card-tag">{{priority}}</div>
          <h4>{{title}}</h4>
          <span class="owner-pill">{{owner}}</span>
        </div>
      `;

      const boardRes = await request(app.getHttpServer())
        .post('/api/method/frappe.views.create_kanban_board')
        .send({
          kanban_board_name: 'Task HTML Custom Board',
          reference_doctype: 'Task',
          field_name: 'status',
          card_template: customCardHtml,
        })
        .expect(201);

      expect(boardRes.body.message.card_template).toBe(customCardHtml);

      // Verify get_kanban_board_data returns the board with card_template
      const dataRes = await request(app.getHttpServer())
        .get('/api/method/frappe.views.get_kanban_board_data?board_name=Task%20HTML%20Custom%20Board')
        .expect(200);

      expect(dataRes.body.message.board.card_template).toContain('custom-kanban-card');
      expect(dataRes.body.message.board.card_template).toContain('{{priority}}');
    });

    it('should support custom card_template and row_template on CustomView', async () => {
      const cardTemplate = '<div class="gallery-card"><h3>{{title}}</h3></div>';
      const rowTemplate = '<tr class="highlighted"><td>{{title}}</td><td>{{status}}</td></tr>';

      const viewRes = await request(app.getHttpServer())
        .post('/api/method/frappe.views.create_custom_view')
        .send({
          title: 'Custom Styled Task Gallery',
          reference_doctype: 'Task',
          view_type: 'Card',
          card_template: cardTemplate,
          row_template: rowTemplate,
        })
        .expect(201);

      expect(viewRes.body.message.card_template).toBe(cardTemplate);
      expect(viewRes.body.message.row_template).toBe(rowTemplate);
    });
  });

  describe('5. Multi-Site Isolation for Main Site Customization', () => {
    it('should serve distinct WebPage and branding for independent sites (Host header routing)', async () => {
      // Create isolated Site Alpha
      const siteAlphaCtx = await siteManager.createSite({
        sitename: 'alpha-portal.local',
        dbType: 'sqlite3',
        dbName: ':memory:',
      });
      await siteManager.migrateSite('alpha-portal.local');

      // Seed custom WebPage and WebsiteSettings on site Alpha
      await siteContext.runWithSite(siteAlphaCtx, async () => {
        const alphaSettings = docService.newDoc('WebsiteSettings', {
          name: 'Website Settings',
          app_name: 'Alpha Portal Inc',
          brand_html: '<h1>ALPHA PORTAL</h1>',
        });
        await alphaSettings.insert();

        const alphaHome = docService.newDoc('WebPage', {
          title: 'Alpha Home',
          route: 'home',
          main_section: '<div>Exclusive Alpha Tenant Content</div>',
          published: 1,
        });
        await alphaHome.insert();
      });

      // Request with Host: alpha-portal.local
      const alphaRes = await request(app.getHttpServer())
        .get('/')
        .set('Host', 'alpha-portal.local')
        .expect(200);

      expect(alphaRes.text).toContain('ALPHA PORTAL');
      expect(alphaRes.text).toContain('Exclusive Alpha Tenant Content');

      // Request to default site should NOT see Alpha's content
      const defaultRes = await request(app.getHttpServer())
        .get('/')
        .expect(200);

      expect(defaultRes.text).not.toContain('Exclusive Alpha Tenant Content');
      expect(defaultRes.text).toContain('⭐ Acme Cloud');
    });
  });
});
