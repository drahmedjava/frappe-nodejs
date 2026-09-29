import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MetaModule } from '../meta/meta.module';
import { DocumentModule } from '../document/document.module';
import { PrintFormatService } from './print-format.service';
import { DataImportExportService } from './data-import-export.service';

@Module({
  imports: [DatabaseModule, MetaModule, DocumentModule],
  providers: [PrintFormatService, DataImportExportService],
  exports: [PrintFormatService, DataImportExportService],
})
export class PeripheralModule {}
