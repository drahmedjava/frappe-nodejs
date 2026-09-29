import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DocumentService } from '../document/document.service';
import { DocTypeRegistryService } from '../meta/doctype-registry.service';
import { SchemaSyncService } from '../meta/schema-sync.service';
import { AuthUser } from '../auth/types';

export interface WorkspaceItem {
  name: string;
  title: string;
  label?: string;
  icon?: string;
  indicator_color?: string;
  parent_page?: string | null;
  category?: string;
  sequence_id: number;
  public: boolean;
  for_user?: string | null;
  is_hidden?: boolean;
  module?: string;
  roles?: string[];
  shortcuts?: any[];
  links?: any[];
  content?: any;
  children?: WorkspaceItem[];
}

export interface WorkspaceSidebarResponse {
  my_workspaces: WorkspaceItem[];
  public_workspaces: WorkspaceItem[];
  all: WorkspaceItem[];
}

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly docService: DocumentService,
    private readonly registry: DocTypeRegistryService,
    private readonly syncService: SchemaSyncService,
  ) {}

  /**
   * Ensures default workspaces are seeded if the table is empty or missing.
   */
  async ensureDefaultWorkspaces(): Promise<void> {
    const knex = this.db.getKnex();
    const hasWorkspaceTable = await knex.schema.hasTable('tabWorkspace');
    if (!hasWorkspaceTable) {
      if (this.registry.has('Workspace')) {
        await this.syncService.syncDocType(this.registry.get('Workspace'));
      }
      if (this.registry.has('WorkspaceRole')) {
        await this.syncService.syncDocType(this.registry.get('WorkspaceRole'));
      }
    }

    const count = await knex('tabWorkspace').count<{ count: number | string }>('name as count').first();
    const total = Number(count?.count || 0);

    if (total === 0) {
      this.logger.log('Seeding standard built-in workspaces...');
      const defaultWorkspaces = [
        {
          title: 'Home',
          label: 'Home',
          icon: '🏠',
          indicator_color: 'blue',
          category: 'Places',
          sequence_id: 1,
          public: 1,
          module: 'Core',
          shortcuts: JSON.stringify([
            { label: 'Tasks', type: 'DocType', link_to: 'Task', color: 'blue' },
            { label: 'Users', type: 'DocType', link_to: 'User', color: 'green' },
            { label: 'Workflows', type: 'DocType', link_to: 'Workflow', color: 'purple' },
          ]),
          links: JSON.stringify([
            {
              label: 'Quick Access',
              items: [
                { label: 'Task Management', type: 'DocType', link_to: 'Task' },
                { label: 'User Accounts', type: 'DocType', link_to: 'User' },
              ],
            },
          ]),
        },
        {
          title: 'Tasks',
          label: 'Tasks',
          icon: '✅',
          indicator_color: 'green',
          category: 'Modules',
          sequence_id: 2,
          public: 1,
          module: 'Task',
          shortcuts: JSON.stringify([
            { label: 'All Tasks', type: 'DocType', link_to: 'Task', color: 'blue' },
            { label: 'Task Items', type: 'DocType', link_to: 'TaskItem', color: 'teal' },
            { label: 'Kanban Boards', type: 'DocType', link_to: 'KanbanBoard', color: 'indigo' },
          ]),
          links: JSON.stringify([
            {
              label: 'Task Operations',
              items: [
                { label: 'Task List', type: 'DocType', link_to: 'Task' },
                { label: 'Checklist Items', type: 'DocType', link_to: 'TaskItem' },
              ],
            },
          ]),
        },
        {
          title: 'Build',
          label: 'Build',
          icon: '⚡',
          indicator_color: 'orange',
          category: 'Administration',
          sequence_id: 3,
          public: 1,
          module: 'Core',
          roles: [{ role: 'System Manager' }],
          shortcuts: JSON.stringify([
            { label: 'Server Scripts', type: 'DocType', link_to: 'ServerScript', color: 'amber' },
            { label: 'Client Scripts', type: 'DocType', link_to: 'ClientScript', color: 'amber' },
            { label: 'Workflows', type: 'DocType', link_to: 'Workflow', color: 'purple' },
            { label: 'Custom Views', type: 'DocType', link_to: 'CustomView', color: 'blue' },
          ]),
          links: JSON.stringify([
            {
              label: 'Customization',
              items: [
                { label: 'Server Scripts', type: 'DocType', link_to: 'ServerScript' },
                { label: 'Client Scripts', type: 'DocType', link_to: 'ClientScript' },
                { label: 'Workflow States', type: 'DocType', link_to: 'WorkflowState' },
                { label: 'Print Formats', type: 'DocType', link_to: 'PrintFormat' },
              ],
            },
          ]),
        },
        {
          title: 'Settings',
          label: 'Settings',
          icon: '⚙️',
          indicator_color: 'gray',
          category: 'Administration',
          sequence_id: 4,
          public: 1,
          module: 'Core',
          roles: [{ role: 'System Manager' }],
          shortcuts: JSON.stringify([
            { label: 'Users', type: 'DocType', link_to: 'User', color: 'blue' },
            { label: 'User Permissions', type: 'DocType', link_to: 'UserPermission', color: 'green' },
            { label: 'Website Settings', type: 'DocType', link_to: 'WebsiteSettings', color: 'indigo' },
          ]),
          links: JSON.stringify([
            {
              label: 'User & Access',
              items: [
                { label: 'Users', type: 'DocType', link_to: 'User' },
                { label: 'User Permissions', type: 'DocType', link_to: 'UserPermission' },
                { label: 'Website Settings', type: 'DocType', link_to: 'WebsiteSettings' },
              ],
            },
          ]),
        },
      ];

      for (const item of defaultWorkspaces) {
        try {
          const doc = this.docService.newDoc('Workspace', item);
          await doc.insert('Administrator');
        } catch (e: any) {
          this.logger.warn(`Could not seed workspace [${item.title}]: ${e.message}`);
        }
      }
      this.logger.log('Default workspaces seeded successfully.');
    }
  }

  /**
   * Retrieves dynamic, per-user workspace sidebar items.
   * Filters by user permissions, roles, and separates private ("My Workspaces") from "Public".
   */
  async getSidebarItems(user: AuthUser): Promise<WorkspaceSidebarResponse> {
    await this.ensureDefaultWorkspaces();

    const knex = this.db.getKnex();
    const rows = await knex('tabWorkspace')
      .where((qb) => {
        qb.whereNull('is_hidden').orWhere('is_hidden', 0).orWhere('is_hidden', false);
      })
      .andWhere((qb) => {
        // Public workspaces OR private workspaces belonging to the current user
        qb.where(function () {
          this.where('public', 1).orWhere('public', true);
        });
        if (user.user && !user.isGuest) {
          qb.orWhere('for_user', user.user);
        }
      })
      .orderBy('sequence_id', 'asc')
      .orderBy('title', 'asc');

    const isSystemManager = user.user === 'Administrator' || user.roles?.includes('System Manager');

    // Retrieve roles for workspaces if table exists
    const hasRoleTable = await knex.schema.hasTable('tabWorkspaceRole');
    let rolesByWorkspace: Record<string, string[]> = {};
    if (hasRoleTable && rows.length > 0) {
      const names = rows.map((r: any) => r.name);
      const roleRows = await knex('tabWorkspaceRole')
        .whereIn('parent', names)
        .where('parenttype', 'Workspace');
      for (const r of roleRows) {
        if (!rolesByWorkspace[r.parent]) rolesByWorkspace[r.parent] = [];
        rolesByWorkspace[r.parent].push(r.role);
      }
    }

    // Filter by roles & assemble items
    const accessibleItems: WorkspaceItem[] = [];
    for (const row of rows) {
      const isPublic = Boolean(row.public === 1 || row.public === true);
      const forUser = row.for_user || null;

      // Private workspaces are only accessible to their owner (or Administrator)
      if (!isPublic && forUser && forUser !== user.user && user.user !== 'Administrator') {
        continue;
      }

      // Check role permissions for public workspaces
      if (isPublic && !isSystemManager) {
        const requiredRoles = rolesByWorkspace[row.name] || [];
        if (requiredRoles.length > 0) {
          const hasMatchingRole = requiredRoles.some((r) => user.roles?.includes(r));
          if (!hasMatchingRole) {
            continue;
          }
        }
      }

      let shortcuts: any[] = [];
      let links: any[] = [];
      try {
        if (row.shortcuts) shortcuts = typeof row.shortcuts === 'string' ? JSON.parse(row.shortcuts) : row.shortcuts;
        if (row.links) links = typeof row.links === 'string' ? JSON.parse(row.links) : row.links;
      } catch (err) {
        this.logger.warn(`Failed to parse shortcuts/links for workspace ${row.name}`);
      }

      accessibleItems.push({
        name: row.name,
        title: row.title,
        label: row.label || row.title,
        icon: row.icon || 'folder',
        indicator_color: row.indicator_color || 'blue',
        parent_page: row.parent_page || null,
        category: row.category || 'Modules',
        sequence_id: row.sequence_id || 0,
        public: isPublic,
        for_user: forUser,
        is_hidden: Boolean(row.is_hidden),
        module: row.module || 'Core',
        roles: rolesByWorkspace[row.name] || [],
        shortcuts,
        links,
        children: [],
      });
    }

    // Build hierarchy (nest child workspaces under their parent_page)
    const itemMap = new Map<string, WorkspaceItem>();
    accessibleItems.forEach((item) => itemMap.set(item.name, item));

    const myWorkspaces: WorkspaceItem[] = [];
    const publicWorkspaces: WorkspaceItem[] = [];

    for (const item of accessibleItems) {
      if (item.parent_page && itemMap.has(item.parent_page)) {
        const parent = itemMap.get(item.parent_page)!;
        parent.children = parent.children || [];
        parent.children.push(item);
      } else {
        if (!item.public || (item.for_user && item.for_user === user.user)) {
          myWorkspaces.push(item);
        } else {
          publicWorkspaces.push(item);
        }
      }
    }

    return {
      my_workspaces: myWorkspaces,
      public_workspaces: publicWorkspaces,
      all: accessibleItems,
    };
  }

  /**
   * Retrieves a single workspace with access check.
   */
  async getWorkspace(name: string, user: AuthUser): Promise<any> {
    await this.ensureDefaultWorkspaces();

    const doc = await this.docService.getDoc('Workspace', name);
    const data = doc.asJson();
    const isPublic = Boolean(data.public === 1 || data.public === true);
    const isSystemManager = user.user === 'Administrator' || user.roles?.includes('System Manager');

    if (!isPublic && data.for_user && data.for_user !== user.user && user.user !== 'Administrator') {
      throw new ForbiddenException(`Access denied to private workspace "${name}"`);
    }

    if (isPublic && !isSystemManager && Array.isArray(data.roles) && data.roles.length > 0) {
      const allowed = data.roles.some((r: any) => user.roles?.includes(r.role));
      if (!allowed) {
        throw new ForbiddenException(`Insufficient permissions to view workspace "${name}"`);
      }
    }

    return data;
  }

  /**
   * Creates or updates a workspace.
   */
  async saveWorkspace(data: Record<string, any>, user: AuthUser): Promise<any> {
    const isSystemManager = user.user === 'Administrator' || user.roles?.includes('System Manager');

    // Non-system managers cannot create or edit public workspaces
    if (data.public && !isSystemManager) {
      data.public = false;
      data.for_user = user.user;
    }

    // If private workspace, ensure for_user is set
    if (!data.public && !data.for_user) {
      data.for_user = user.user;
    }

    if (data.name && (await this.db.hasTable('tabWorkspace'))) {
      const existing = await this.db.getKnex()('tabWorkspace').where({ name: data.name }).first();
      if (existing) {
        const doc = await this.docService.getDoc('Workspace', data.name);
        if (!existing.public && existing.for_user !== user.user && !isSystemManager) {
          throw new ForbiddenException('Cannot edit another user’s private workspace');
        }
        Object.assign(doc, data);
        await doc.save(user.user);
        return doc.asJson();
      }
    }

    const newDoc = this.docService.newDoc('Workspace', data);
    await newDoc.insert(user.user);
    return newDoc.asJson();
  }

  /**
   * Deletes a workspace.
   */
  async deleteWorkspace(name: string, user: AuthUser): Promise<boolean> {
    const isSystemManager = user.user === 'Administrator' || user.roles?.includes('System Manager');
    const doc = await this.docService.getDoc('Workspace', name);
    const isPublic = Boolean(doc.get('public'));

    if (isPublic && !isSystemManager) {
      throw new ForbiddenException('Only System Managers can delete public workspaces');
    }
    if (!isPublic && doc.get('for_user') !== user.user && !isSystemManager) {
      throw new ForbiddenException('Cannot delete another user’s workspace');
    }

    await doc.delete();
    return true;
  }
}
