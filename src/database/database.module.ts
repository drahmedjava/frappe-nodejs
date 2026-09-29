import { Global, Module } from '@nestjs/common';
import { DatabaseService, KNEX_CONNECTION } from './database.service';
import { Knex } from 'knex';

@Global()
@Module({
  providers: [
    DatabaseService,
    {
      provide: KNEX_CONNECTION,
      useFactory: (dbService: DatabaseService): Knex => dbService.getKnex(),
      inject: [DatabaseService],
    },
  ],
  exports: [DatabaseService, KNEX_CONNECTION],
})
export class DatabaseModule {}
