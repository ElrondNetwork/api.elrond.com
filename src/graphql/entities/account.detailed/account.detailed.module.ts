import { Module } from "@nestjs/common";

import { AccountDetailedResolver } from "src/graphql/entities/account.detailed/account.detailed.resolver";
import { AccountModule } from "src/endpoints/accounts/account.module";
import { CollectionModule } from "src/endpoints/collections/collection.module";
import { NftModule } from "src/endpoints/nfts/nft.module";

@Module({
  imports: [AccountModule, CollectionModule, NftModule],
  providers: [AccountDetailedResolver],
})
export class AccountDetailedModule {}
