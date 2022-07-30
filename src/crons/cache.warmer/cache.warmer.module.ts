import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheWarmerService } from './cache.warmer.service';
import { EndpointsServicesModule } from '../../endpoints/endpoints.services.module';
import { KeybaseModule } from 'src/common/keybase/keybase.module';
import { MexModule } from 'src/endpoints/mex/mex.module';
import { AssetsModule } from 'src/common/assets/assets.module';
import { DynamicModuleUtils } from 'src/utils/dynamic.module.utils';
import { CollectionModule } from '../../endpoints/collections/collection.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    EndpointsServicesModule,
    KeybaseModule,
    MexModule,
    AssetsModule,
    CollectionModule,
  ],
  providers: [
    DynamicModuleUtils.getPubSubService(),
    CacheWarmerService,
  ],
})
export class CacheWarmerModule { }
