import { Module } from '@nestjs/common';
import { DeskController } from './desk.controller';

@Module({
  controllers: [DeskController],
})
export class DeskModule {}
