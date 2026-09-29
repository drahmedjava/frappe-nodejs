import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DocType } from '../meta/types';
import * as crypto from 'crypto';

@Injectable()
export class NamingService implements OnModuleInit {
  private readonly logger = new Logger(NamingService.name);

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit() {
    await this.ensureSeriesTable();
  }

  async ensureSeriesTable(): Promise<void> {
    const knex = this.db.getKnex();
    const exists = await knex.schema.hasTable('tabSeries');
    if (!exists) {
      await knex.schema.createTable('tabSeries', (table) => {
        table.string('name', 140).primary();
        table.integer('current').defaultTo(0);
      });
      this.logger.log('Created tabSeries table for autonaming');
    }
  }

  /**
   * Generates a unique document name based on DocType autoname rules.
   */
  async generateName(docType: DocType, docData: Record<string, any>): Promise<string> {
    const autoname = docType.autoname;

    // 1. Field based naming: "field:fieldname"
    if (autoname?.startsWith('field:')) {
      const fieldname = autoname.replace('field:', '').trim();
      const val = docData[fieldname];
      if (!val) {
        throw new Error(`Cannot generate name: Field "${fieldname}" is empty`);
      }
      return String(val).trim();
    }

    // 2. Hash naming: "hash"
    if (autoname === 'hash' || docType.namingRule === 'hash') {
      return crypto.randomBytes(5).toString('hex'); // 10-char hex
    }

    // 3. Series naming: e.g. "TASK-.#####" or "PO-.YYYY.-.#####"
    if (autoname && autoname.includes('.#')) {
      return this.generateSeriesName(autoname);
    }

    // 4. Autoincrement or default series: e.g. namingRule === 'series' with default prefix
    if (docType.namingRule === 'series') {
      const defaultPrefix = `${docType.name.toUpperCase()}-`;
      return this.getNextSeries(defaultPrefix, 5);
    }

    // 5. Default fallback: 10-character random hash
    return crypto.randomBytes(5).toString('hex');
  }

  /**
   * Parses autoname template with date tokens and hash count.
   * Example: "TASK-.#####" -> "TASK-00001"
   * Example: "PO-.YYYY.-.#####" -> "PO-2026-00001"
   */
  private async generateSeriesName(template: string): Promise<string> {
    const now = new Date();
    const year = String(now.getFullYear());
    const shortYear = year.slice(-2);
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    // Replace date tokens
    let prefix = template
      .replace(/\.YYYY\./g, year)
      .replace(/\.YY\./g, shortYear)
      .replace(/\.MM\./g, month)
      .replace(/\.DD\./g, day);

    // Count hashes at the end
    const hashMatch = prefix.match(/\.(#+)$/);
    if (!hashMatch) {
      // Just series without leading dot e.g. "TASK-#####"
      const simpleMatch = prefix.match(/(#+)$/);
      if (simpleMatch) {
        const digits = simpleMatch[1].length;
        const basePrefix = prefix.slice(0, -digits);
        return this.getNextSeries(basePrefix, digits);
      }
      return `${prefix}${crypto.randomBytes(3).toString('hex')}`;
    }

    const digits = hashMatch[1].length;
    const basePrefix = prefix.slice(0, hashMatch.index);
    return this.getNextSeries(basePrefix, digits);
  }

  /**
   * Atomically gets the next number for a series prefix.
   */
  async getNextSeries(prefix: string, digits: number): Promise<string> {
    await this.ensureSeriesTable();

    return this.db.transaction(async (trx) => {
      const row = await trx('tabSeries').where({ name: prefix }).forUpdate?.().first() ||
                  await trx('tabSeries').where({ name: prefix }).first();

      let nextVal = 1;

      if (!row) {
        await trx('tabSeries').insert({ name: prefix, current: 1 });
      } else {
        nextVal = Number(row.current) + 1;
        await trx('tabSeries').where({ name: prefix }).update({ current: nextVal });
      }

      const formattedNumber = String(nextVal).padStart(digits, '0');
      return `${prefix}${formattedNumber}`;
    });
  }
}
