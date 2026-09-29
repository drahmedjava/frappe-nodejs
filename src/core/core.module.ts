import { Global, Module } from '@nestjs/common';
import { FrappeFeatureService } from './frappe-feature.service';
import { ApiModule } from '../api/api.module';

@Global()
@Module({
  imports: [ApiModule],
  providers: [FrappeFeatureService],
  exports: [FrappeFeatureService],
})
export class CoreModule {}
