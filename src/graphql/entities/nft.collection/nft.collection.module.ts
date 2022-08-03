import { Module } from "@nestjs/common";

import { AccountModule } from "src/endpoints/accounts/account.module";
import { CollectionModule } from "src/endpoints/collections/collection.module";
import { NftCollectionLoader } from "src/graphql/entities/nft.collection/nft.collection.loader";
import { NftCollectionResolver } from "src/graphql/entities/nft.collection/nft.collection.resolver";

@Module({
  imports: [AccountModule, CollectionModule],
  providers: [NftCollectionLoader, NftCollectionResolver],
})
export class NftCollectionModule {}
