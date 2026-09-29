import { Module } from '@nestjs/common';
import { DeskController } from './desk.controller';
import { WorkspaceService } from './workspace.service';
import { DocumentModule } from '../document/document.module';
import { DatabaseModule } from '../database/database.module';
import { MetaModule } from '../meta/meta.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DocumentModule, DatabaseModule, MetaModule, AuthModule],
  controllers: [DeskController],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class DeskModule {}

