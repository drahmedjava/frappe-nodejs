import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { configuration } from '../src/config/configuration';
import { DatabaseModule } from '../src/database/database.module';
import { DatabaseService } from '../src/database/database.service';
import { MetaModule } from '../src/meta/meta.module';
import { DocTypeRegistryService } from '../src/meta/doctype-registry.service';
import { SchemaSyncService } from '../src/meta/schema-sync.service';
import { DocValidatorService, DocValidationError } from '../src/meta/doc-validator.service';
import { DocType } from '../src/meta/types';

describe('Phase 1 Meta Engine Tests', () => {
  let moduleRef: TestingModule;
  let db: DatabaseService;
  let registry: DocTypeRegistryService;
  let syncService: SchemaSyncService;
  let validator: DocValidatorService;

  beforeAll(async () => {
    process.env.DB_CLIENT = 'sqlite3';
    process.env.DB_FILENAME = ':memory:';
    process.env.REDIS_ENABLED = 'false';

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [configuration],
        }),
        DatabaseModule,
        MetaModule,
      ],
    }).compile();

    db = moduleRef.get<DatabaseService>(DatabaseService);
    registry = moduleRef.get<DocTypeRegistryService>(DocTypeRegistryService);
    syncService = moduleRef.get<SchemaSyncService>(SchemaSyncService);
    validator = moduleRef.get<DocValidatorService>(DocValidatorService);

    // Trigger onModuleInit to load built-in doctypes
    registry.onModuleInit();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  describe('DocTypeRegistryService', () => {
    it('should have loaded built-in Task and TaskItem DocTypes', () => {
      expect(registry.has('Task')).toBe(true);
      expect(registry.has('TaskItem')).toBe(true);

      const taskMeta = registry.get('Task');
      expect(taskMeta.name).toBe('Task');
      expect(taskMeta.module).toBe('Projects');
      expect(taskMeta.namingRule).toBe('series');
      expect(taskMeta.autoname).toBe('TASK-.#####');
      expect(taskMeta.fields.length).toBeGreaterThan(5);

      const taskItemMeta = registry.get('TaskItem');
      expect(taskItemMeta.isChildTable).toBe(true);
    });

    it('should throw when getting non-existent DocType', () => {
      expect(() => registry.get('NonExistentDocType')).toThrow(/not found in registry/);
    });

    it('should allow registering a custom DocType at runtime', () => {
      const customDocType: DocType = {
        name: 'Project',
        module: 'Projects',
        fields: [
          { fieldname: 'project_name', label: 'Project Name', fieldtype: 'Data', reqd: true },
          { fieldname: 'budget', label: 'Budget', fieldtype: 'Currency', default: 0 },
        ],
      };

      registry.register(customDocType);
      expect(registry.has('Project')).toBe(true);
      expect(registry.get('Project').fields[0].fieldname).toBe('project_name');
    });
  });

  describe('DocValidatorService', () => {
    it('should validate and apply defaults to valid payload', () => {
      const taskMeta = registry.get('Task');
      const payload = {
        title: 'Complete Phase 1',
        description: 'Implement DocType registry and schema sync',
      };

      const cleaned = validator.validate(taskMeta, payload, true);
      expect(cleaned.title).toBe('Complete Phase 1');
      expect(cleaned.status).toBe('Open'); // default applied
      expect(cleaned.priority).toBe('Medium'); // default applied
      expect(cleaned.progress).toBe(0); // default applied
      expect(cleaned.is_completed).toBe(0); // default coerced
    });

    it('should reject missing required field', () => {
      const taskMeta = registry.get('Task');
      const invalidPayload = {
        description: 'Missing title',
      };

      expect(() => validator.validate(taskMeta, invalidPayload, true)).toThrow(DocValidationError);
      try {
        validator.validate(taskMeta, invalidPayload, true);
      } catch (err: any) {
        expect(err.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: 'title', message: 'Field is required' }),
          ]),
        );
      }
    });

    it('should reject invalid Select option', () => {
      const taskMeta = registry.get('Task');
      const invalidPayload = {
        title: 'Invalid select test',
        status: 'UnknownStatus',
      };

      expect(() => validator.validate(taskMeta, invalidPayload, true)).toThrow(DocValidationError);
    });

    it('should validate child tables correctly', () => {
      const taskMeta = registry.get('Task');
      const validPayload = {
        title: 'Task with items',
        items: [
          { item_name: 'Subtask 1', completed: false },
          { item_name: 'Subtask 2', completed: true },
        ],
      };

      const cleaned = validator.validate(taskMeta, validPayload, true);
      expect(cleaned.items).toHaveLength(2);
      expect(cleaned.items[0].completed).toBe(0);
      expect(cleaned.items[1].completed).toBe(1);
    });
  });

  describe('SchemaSyncService', () => {
    it('should sync Task and TaskItem schemas and create DB tables', async () => {
      await syncService.syncAll();

      const knex = db.getKnex();
      const hasTaskTable = await knex.schema.hasTable('tabTask');
      const hasTaskItemTable = await knex.schema.hasTable('tabTaskItem');

      expect(hasTaskTable).toBe(true);
      expect(hasTaskItemTable).toBe(true);

      const taskCols = await knex('tabTask').columnInfo();
      // Verify standard audit columns
      expect(taskCols).toHaveProperty('name');
      expect(taskCols).toHaveProperty('creation');
      expect(taskCols).toHaveProperty('modified');
      expect(taskCols).toHaveProperty('modified_by');
      expect(taskCols).toHaveProperty('owner');
      expect(taskCols).toHaveProperty('docstatus');
      expect(taskCols).toHaveProperty('idx');

      // Verify custom fields
      expect(taskCols).toHaveProperty('title');
      expect(taskCols).toHaveProperty('description');
      expect(taskCols).toHaveProperty('status');
      expect(taskCols).toHaveProperty('progress');
      expect(taskCols).toHaveProperty('is_completed');

      // Verify child table parent linkage columns
      const itemCols = await knex('tabTaskItem').columnInfo();
      expect(itemCols).toHaveProperty('parent');
      expect(itemCols).toHaveProperty('parenttype');
      expect(itemCols).toHaveProperty('parentfield');
      expect(itemCols).toHaveProperty('item_name');
    });

    it('should alter table when a new field is added to DocType', async () => {
      const knex = db.getKnex();
      const taskMeta = registry.get('Task');

      // Insert test row into tabTask
      const now = new Date().toISOString();
      await knex('tabTask').insert({
        name: 'TASK-00001',
        creation: now,
        modified: now,
        title: 'Existing Task',
        status: 'Open',
      });

      // Add a new field: estimated_hours
      taskMeta.fields.push({
        fieldname: 'estimated_hours',
        label: 'Estimated Hours',
        fieldtype: 'Float',
        default: 0,
      });

      // Run sync again
      await syncService.syncDocType(taskMeta);

      const updatedCols = await knex('tabTask').columnInfo();
      expect(updatedCols).toHaveProperty('estimated_hours');

      // Verify previous data was preserved
      const row = await knex('tabTask').where({ name: 'TASK-00001' }).first();
      expect(row.title).toBe('Existing Task');
    });
  });
});
