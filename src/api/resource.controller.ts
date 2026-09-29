import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  ForbiddenException,
  NotFoundException,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { DocTypeRegistryService } from '../meta/doctype-registry.service';
import { DocumentService } from '../document/document.service';
import { PermissionService } from '../auth/permission.service';
import { UserPermissionService } from '../auth/user-permission.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { GetListOptions } from '../document/types';
import { WorkflowService } from '../lowcode/workflow.service';
import { PrintFormatService } from '../peripheral/print-format.service';
import { DataImportExportService } from '../peripheral/data-import-export.service';

@Controller('api/resource')
export class ResourceController {
  constructor(
    private readonly registry: DocTypeRegistryService,
    private readonly docService: DocumentService,
    private readonly permissionService: PermissionService,
    private readonly userPermissionService: UserPermissionService,
    private readonly workflowService: WorkflowService,
    private readonly printFormatService: PrintFormatService,
    private readonly importExportService: DataImportExportService,
  ) {}

  @Get(':doctype')
  async getList(
    @Param('doctype') doctype: string,
    @Query() query: Record<string, any>,
    @CurrentUser() user: AuthUser,
  ) {
    const meta = this.registry.get(doctype);
    this.permissionService.assertPermission(meta, 'read', user);

    const options: GetListOptions = {};

    // Parse fields
    if (query.fields) {
      if (typeof query.fields === 'string') {
        try {
          options.fields = JSON.parse(query.fields);
        } catch {
          options.fields = query.fields.split(',').map((f) => f.trim());
        }
      } else if (Array.isArray(query.fields)) {
        options.fields = query.fields;
      }
    }

    // Parse user-provided filters
    if (query.filters) {
      if (typeof query.filters === 'string') {
        try {
          options.filters = JSON.parse(query.filters);
        } catch {
          // If not valid JSON, leave undefined
        }
      } else {
        options.filters = query.filters;
      }
    }

    // Inject row-level security & user permissions
    const { where, whereIn } = await this.userPermissionService.getPermissionFilters(meta, user);
    if (Object.keys(where).length > 0) {
      options.filters = { ...(typeof options.filters === 'object' && !Array.isArray(options.filters) ? options.filters : {}), ...where };
    }
    if (Object.keys(whereIn).length > 0) {
      options.whereIn = { ...(options.whereIn || {}), ...whereIn };
    }

    // Parse ordering
    if (query.order_by || query.orderBy) {
      options.orderBy = query.order_by || query.orderBy;
    }

    // Parse pagination
    const limit = query.limit_page_length || query.limit;
    if (limit !== undefined) {
      options.limit = Number(limit);
    }

    const offset = query.limit_start || query.offset;
    if (offset !== undefined) {
      options.offset = Number(offset);
    }

    const rows = await this.docService.getList(doctype, options);
    const sanitizedRows = rows.map((r) => this.userPermissionService.filterPermittedFields(meta, r, user));

    return { data: sanitizedRows };
  }

  @Get(':doctype/export')
  async exportData(
    @Param('doctype') doctype: string,
    @Query('format') format: string = 'json',
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const meta = this.registry.get(doctype);
    this.permissionService.assertPermission(meta, 'read', user);

    const exportFormat = (format?.toLowerCase() === 'csv' ? 'csv' : 'json') as 'csv' | 'json';
    const result = await this.importExportService.exportData(doctype, exportFormat);

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return result.data;
  }

  @Get(':doctype/:name')
  async getDoc(
    @Param('doctype') doctype: string,
    @Param('name') name: string,
    @CurrentUser() user: AuthUser,
  ) {
    const meta = this.registry.get(doctype);
    this.permissionService.assertPermission(meta, 'read', user);

    const doc = await this.docService.getDoc(doctype, name);
    const hasRowAccess = await this.userPermissionService.checkDocRowPermission(meta, doc.data, user);
    if (!hasRowAccess) {
      throw new ForbiddenException(`Access denied to document "${name}" due to User Permissions`);
    }

    const sanitized = this.userPermissionService.filterPermittedFields(meta, doc.asJson(), user);
    return { data: sanitized };
  }

  @Post(':doctype/import')
  async importData(
    @Param('doctype') doctype: string,
    @Query('format') format: string = 'json',
    @Body() body: any,
    @CurrentUser() user: AuthUser,
  ) {
    const meta = this.registry.get(doctype);
    this.permissionService.assertPermission(meta, 'create', user);

    const importFormat = (format?.toLowerCase() === 'csv' ? 'csv' : 'json') as 'csv' | 'json';
    const content = body.data || body.csv || body;
    const result = await this.importExportService.importData(doctype, content, importFormat, user.user);

    return { data: result };
  }

  @Post(':doctype')
  async createDoc(
    @Param('doctype') doctype: string,
    @Body() body: Record<string, any>,
    @CurrentUser() user: AuthUser,
  ) {
    const meta = this.registry.get(doctype);
    this.permissionService.assertPermission(meta, 'create', user);

    const data = body.data || body;
    const doc = this.docService.newDoc(doctype, data);
    await doc.insert(user.user);

    const sanitized = this.userPermissionService.filterPermittedFields(meta, doc.asJson(), user);
    return { data: sanitized };
  }

  @Put(':doctype/:name')
  async updateDoc(
    @Param('doctype') doctype: string,
    @Param('name') name: string,
    @Body() body: Record<string, any>,
    @CurrentUser() user: AuthUser,
  ) {
    const meta = this.registry.get(doctype);
    const data = body.data || body;

    const doc = await this.docService.getDoc(doctype, name);
    const hasRowAccess = await this.userPermissionService.checkDocRowPermission(meta, doc.data, user);
    if (!hasRowAccess) {
      throw new ForbiddenException(`Access denied to document "${name}" due to User Permissions`);
    }

    // Handle submit transition
    if (data.docstatus === 1 && doc.docstatus === 0) {
      this.permissionService.assertPermission(meta, 'submit', user);
      Object.assign(doc.data, data);
      await doc.submit(user.user);
      const sanitized = this.userPermissionService.filterPermittedFields(meta, doc.asJson(), user);
      return { data: sanitized };
    }

    // Handle cancel transition
    if (data.docstatus === 2 && doc.docstatus === 1) {
      this.permissionService.assertPermission(meta, 'cancel', user);
      await doc.cancel(user.user);
      const sanitized = this.userPermissionService.filterPermittedFields(meta, doc.asJson(), user);
      return { data: sanitized };
    }

    // Regular write/update
    this.permissionService.assertPermission(meta, 'write', user);
    for (const [key, value] of Object.entries(data)) {
      if (!['name', 'creation', 'owner'].includes(key)) {
        doc.set(key, value);
      }
    }

    await doc.save(user.user);
    const sanitized = this.userPermissionService.filterPermittedFields(meta, doc.asJson(), user);
    return { data: sanitized };
  }

  @Delete(':doctype/:name')
  async deleteDoc(
    @Param('doctype') doctype: string,
    @Param('name') name: string,
    @CurrentUser() user: AuthUser,
  ) {
    const meta = this.registry.get(doctype);
    this.permissionService.assertPermission(meta, 'delete', user);

    const doc = await this.docService.getDoc(doctype, name);
    const hasRowAccess = await this.userPermissionService.checkDocRowPermission(meta, doc.data, user);
    if (!hasRowAccess) {
      throw new ForbiddenException(`Access denied to document "${name}" due to User Permissions`);
    }

    await doc.delete();
    return { message: 'ok' };
  }

  @Get(':doctype/:name/transitions')
  async getTransitions(
    @Param('doctype') doctype: string,
    @Param('name') name: string,
    @CurrentUser() user: AuthUser,
  ) {
    const doc = await this.docService.getDoc(doctype, name);
    const transitions = await this.workflowService.getAvailableTransitions(doc, user);
    return { data: transitions };
  }

  @Post(':doctype/:name/workflow')
  async applyWorkflow(
    @Param('doctype') doctype: string,
    @Param('name') name: string,
    @Body('action') action: string,
    @CurrentUser() user: AuthUser,
  ) {
    const doc = await this.docService.getDoc(doctype, name);
    const updated = await this.workflowService.applyWorkflow(doc, action, user);
    return { data: updated.asJson() };
  }

  @Post(':doctype/:name/amend')
  async amendDoc(
    @Param('doctype') doctype: string,
    @Param('name') name: string,
    @CurrentUser() user: AuthUser,
  ) {
    const meta = this.registry.get(doctype);
    this.permissionService.assertPermission(meta, 'amend', user);

    const doc = await this.docService.getDoc(doctype, name);
    const hasRowAccess = await this.userPermissionService.checkDocRowPermission(meta, doc.data, user);
    if (!hasRowAccess) {
      throw new ForbiddenException(`Access denied to document "${name}" due to User Permissions`);
    }

    const amended = await doc.amend(user.user);
    const sanitized = this.userPermissionService.filterPermittedFields(meta, amended.asJson(), user);
    return { data: sanitized };
  }

  @Post(':doctype/:name/:method')
  async runDocMethod(
    @Param('doctype') doctype: string,
    @Param('name') name: string,
    @Param('method') method: string,
    @Body() body: Record<string, any>,
    @CurrentUser() user: AuthUser,
  ) {
    if (['workflow', 'amend'].includes(method) || method.startsWith('_')) {
      throw new NotFoundException(`Method "${method}" not found on document ${doctype}`);
    }

    const meta = this.registry.get(doctype);
    this.permissionService.assertPermission(meta, 'read', user);

    const doc = await this.docService.getDoc(doctype, name);
    const hasRowAccess = await this.userPermissionService.checkDocRowPermission(meta, doc.data, user);
    if (!hasRowAccess) {
      throw new ForbiddenException(`Access denied to document "${name}" due to User Permissions`);
    }

    if (typeof (doc as any)[method] !== 'function') {
      throw new NotFoundException(`Method "${method}" does not exist on document "${doctype}"`);
    }

    const result = await (doc as any)[method](body, { user });
    if (result !== undefined) {
      return { data: result };
    }
    return { data: doc.asJson() };
  }

  @Get(':doctype/:name/versions')
  async getVersions(
    @Param('doctype') doctype: string,
    @Param('name') name: string,
    @CurrentUser() user: AuthUser,
  ) {
    const meta = this.registry.get(doctype);
    this.permissionService.assertPermission(meta, 'read', user);

    const doc = await this.docService.getDoc(doctype, name);
    const versions = await doc.getVersions();
    return { data: versions };
  }

  @Get(':doctype/:name/print')
  async printDoc(
    @Param('doctype') doctype: string,
    @Param('name') name: string,
    @Query('format') format: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const meta = this.registry.get(doctype);
    this.permissionService.assertPermission(meta, 'read', user);

    const doc = await this.docService.getDoc(doctype, name);
    const hasRowAccess = await this.userPermissionService.checkDocRowPermission(meta, doc.data, user);
    if (!hasRowAccess) {
      throw new ForbiddenException(`Access denied to document "${name}" due to User Permissions`);
    }

    const html = await this.printFormatService.render(doc, format);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return html;
  }
}
