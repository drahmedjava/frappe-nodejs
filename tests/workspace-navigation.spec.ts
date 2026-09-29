import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { WorkspaceService } from '../src/desk/workspace.service';
import { SchemaSyncService } from '../src/meta/schema-sync.service';
import { AuthUser } from '../src/auth/types';

describe('Frappe Left Side Navigation Panel (Workspace Navigation & Per-User Personalization)', () => {
  let app: INestApplication;
  let workspaceService: WorkspaceService;
  let schemaSync: SchemaSyncService;

  const adminUser: AuthUser = {
    user: 'Administrator',
    roles: ['System Manager', 'All'],
    isGuest: false,
  };

  const regularUser: AuthUser = {
    user: 'john@example.com',
    roles: ['All'],
    isGuest: false,
  };

  const otherUser: AuthUser = {
    user: 'sarah@example.com',
    roles: ['All'],
    isGuest: false,
  };

  beforeAll(async () => {
    process.env.DB_CLIENT = 'sqlite3';
    process.env.DB_FILENAME = ':memory:';
    process.env.REDIS_ENABLED = 'false';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    workspaceService = moduleRef.get<WorkspaceService>(WorkspaceService);
    schemaSync = moduleRef.get<SchemaSyncService>(SchemaSyncService);

    // Sync all DocTypes into SQLite memory database
    await schemaSync.syncAll();
    await workspaceService.ensureDefaultWorkspaces();
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. should seed standard default workspaces into the database', async () => {
    const sidebar = await workspaceService.getSidebarItems(adminUser);
    expect(sidebar.public_workspaces.length).toBeGreaterThanOrEqual(4);

    const titles = sidebar.public_workspaces.map((w) => w.title);
    expect(titles).toContain('Home');
    expect(titles).toContain('Tasks');
    expect(titles).toContain('Build');
    expect(titles).toContain('Settings');
  });

  it('2. should enforce role-based dynamic filtering (System Manager vs Regular User)', async () => {
    const adminSidebar = await workspaceService.getSidebarItems(adminUser);
    const adminTitles = adminSidebar.public_workspaces.map((w) => w.title);
    expect(adminTitles).toContain('Build');
    expect(adminTitles).toContain('Settings');

    // Regular user has only ['All'] role, so Build and Settings must be filtered out
    const regularSidebar = await workspaceService.getSidebarItems(regularUser);
    const regularTitles = regularSidebar.public_workspaces.map((w) => w.title);
    expect(regularTitles).toContain('Home');
    expect(regularTitles).toContain('Tasks');
    expect(regularTitles).not.toContain('Build');
    expect(regularTitles).not.toContain('Settings');
  });

  it('3. should support per-user private workspaces ("My Workspaces")', async () => {
    // John creates a private workspace
    await workspaceService.saveWorkspace(
      {
        title: 'John Private Workspace',
        label: 'My Daily Work',
        icon: '💼',
        public: false,
        shortcuts: JSON.stringify([{ label: 'Tasks', type: 'DocType', link_to: 'Task' }]),
      },
      regularUser,
    );

    // John sees it in his "My Workspaces"
    const johnSidebar = await workspaceService.getSidebarItems(regularUser);
    const johnMyTitles = johnSidebar.my_workspaces.map((w) => w.title);
    expect(johnMyTitles).toContain('John Private Workspace');

    // Sarah does NOT see John's private workspace
    const sarahSidebar = await workspaceService.getSidebarItems(otherUser);
    const sarahMyTitles = sarahSidebar.my_workspaces.map((w) => w.title);
    const sarahPublicTitles = sarahSidebar.public_workspaces.map((w) => w.title);
    expect(sarahMyTitles).not.toContain('John Private Workspace');
    expect(sarahPublicTitles).not.toContain('John Private Workspace');
  });

  it('4. should support hierarchical nested workspaces (parent_page)', async () => {
    // Create a sub-workspace under Tasks
    await workspaceService.saveWorkspace(
      {
        title: 'Project Alpha Tasks',
        label: 'Project Alpha',
        icon: '📁',
        parent_page: 'Tasks',
        public: true,
      },
      adminUser,
    );

    const sidebar = await workspaceService.getSidebarItems(adminUser);
    const tasksWorkspace = sidebar.public_workspaces.find((w) => w.title === 'Tasks');
    expect(tasksWorkspace).toBeDefined();
    expect(tasksWorkspace?.children).toBeDefined();
    expect(tasksWorkspace?.children?.some((c) => c.title === 'Project Alpha Tasks')).toBe(true);
  });

  it('5. should expose workspace sidebar items via RPC API', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/method/frappe.desk.desktop.get_workspace_sidebar_items')
      .expect(200);

    expect(res.body).toHaveProperty('message');
    expect(res.body.message).toHaveProperty('public_workspaces');
    expect(res.body.message).toHaveProperty('my_workspaces');
    expect(Array.isArray(res.body.message.public_workspaces)).toBe(true);
  });

  it('6. should retrieve a single workspace definition via RPC API', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/method/frappe.desk.desktop.get_workspace')
      .query({ name: 'Home' })
      .expect(200);

    expect(res.body).toHaveProperty('message');
    expect(res.body.message.title).toBe('Home');
    expect(res.body.message.icon).toBe('🏠');
  });
});
