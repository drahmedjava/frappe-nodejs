import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { DocType, DocTypeSchema } from './types';

@Injectable()
export class DocTypeRegistryService implements OnModuleInit {
  private readonly logger = new Logger(DocTypeRegistryService.name);
  private readonly registry = new Map<string, DocType>();

  onModuleInit() {
    this.loadBuiltInDocTypes();
  }

  register(docType: DocType): void {
    const validated = DocTypeSchema.parse(docType);
    this.registry.set(validated.name, validated);
    this.logger.log(`Registered DocType: [${validated.name}]`);
  }

  get(name: string): DocType {
    const docType = this.registry.get(name);
    if (!docType) {
      throw new Error(`DocType "${name}" not found in registry`);
    }
    return docType;
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  getAll(): DocType[] {
    return Array.from(this.registry.values());
  }

  loadFromDirectory(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      this.logger.warn(`DocType directory does not exist: ${dirPath}`);
      return;
    }

    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        this.loadFromDirectory(fullPath);
      } else if (file.endsWith('.json')) {
        try {
          const raw = fs.readFileSync(fullPath, 'utf-8');
          const parsed = JSON.parse(raw);
          this.register(parsed);
        } catch (err: any) {
          this.logger.error(`Failed to load DocType from ${fullPath}: ${err.message}`);
        }
      }
    }
  }

  loadBuiltInDocTypes(): void {
    const candidates = [
      path.join(__dirname, 'doctypes'),
      path.join(process.cwd(), 'dist', 'meta', 'doctypes'),
      path.join(process.cwd(), 'src', 'meta', 'doctypes'),
    ];

    for (const dir of candidates) {
      if (fs.existsSync(dir)) {
        this.loadFromDirectory(dir);
        break;
      }
    }
  }
}
