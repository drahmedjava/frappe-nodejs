import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { DocTypeRegistryService } from '../meta/doctype-registry.service';
import { DocumentService } from '../document/document.service';
import { PermissionService } from '../auth/permission.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/types';
import { GetListOptions } from '../document/types';

@Controller('api/resource')
export class ResourceController {
  constructor(
    private readonly registry: DocTypeRegistryService,
    private readonly docService: DocumentService,
    private readonly permissionService: PermissionService,
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

    // Parse filters
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
    return { data: rows };
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
    return { data: doc.asJson() };
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

    return { data: doc.asJson() };
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

    // Handle submit transition
    if (data.docstatus === 1 && doc.docstatus === 0) {
      this.permissionService.assertPermission(meta, 'submit', user);
      Object.assign(doc.data, data);
      await doc.submit(user.user);
      return { data: doc.asJson() };
    }

    // Handle cancel transition
    if (data.docstatus === 2 && doc.docstatus === 1) {
      this.permissionService.assertPermission(meta, 'cancel', user);
      await doc.cancel(user.user);
      return { data: doc.asJson() };
    }

    // Regular write/update
    this.permissionService.assertPermission(meta, 'write', user);
    for (const [key, value] of Object.entries(data)) {
      if (!['name', 'creation', 'owner'].includes(key)) {
        doc.set(key, value);
      }
    }

    await doc.save(user.user);
    return { data: doc.asJson() };
  }

  @Delete(':doctype/:name')
  async deleteDoc(
    @Param('doctype') doctype: string,
    @Param('name') name: string,
    @CurrentUser() user: AuthUser,
  ) {
    const meta = this.registry.get(doctype);
    this.permissionService.assertPermission(meta, 'delete', user);

    await this.docService.deleteDoc(doctype, name);
    return { message: 'ok' };
  }
}
