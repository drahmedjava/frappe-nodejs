import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { SchemaSyncService } from './meta/schema-sync.service';
import { DocumentService } from './document/document.service';
import { DatabaseService } from './database/database.service';

async function migrate() {
  const logger = new Logger('Migrate');
  logger.log('Starting Frappe database migration...');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });

  const syncService = app.get(SchemaSyncService);
  await syncService.syncAll();
  logger.log('All DocType schemas synchronized successfully.');

  const docService = app.get(DocumentService);
  const db = app.get(DatabaseService);
  const knex = db.getKnex();
  const hasUserTable = await knex.schema.hasTable('tabUser');
  if (hasUserTable) {
    const adminExists = await knex('tabUser').where({ email: 'Administrator' }).orWhere({ name: 'Administrator' }).first();
    if (!adminExists) {
      const adminDoc = docService.newDoc('User', {
        email: 'Administrator',
        first_name: 'Administrator',
        enabled: 1,
        roles: [{ role: 'System Manager' }, { role: 'All' }],
      });
      await adminDoc.insert('Administrator');
      logger.log('Seeded default Administrator user.');
    }
  }

  try {
    const { WorkspaceService } = await import('./desk/workspace.service');
    const wsService = app.get(WorkspaceService);
    await wsService.ensureDefaultWorkspaces();
    logger.log('Default workspaces verified/seeded.');
  } catch (err: any) {
    logger.warn(`Could not seed workspaces: ${err.message}`);
  }

  await app.close();

  logger.log('Migration completed successfully.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
