import { Global, Module } from '@nestjs/common';
import { DocTypeRegistryService } from './doctype-registry.service';
import { SchemaSyncService } from './schema-sync.service';
import { DocValidatorService } from './doc-validator.service';

@Global()
@Module({
  providers: [DocTypeRegistryService, SchemaSyncService, DocValidatorService],
  exports: [DocTypeRegistryService, SchemaSyncService, DocValidatorService],
})
export class MetaModule {}
