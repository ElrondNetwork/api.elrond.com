import { Parent, ResolveField, Resolver } from "@nestjs/graphql";

import { Account } from "src/endpoints/accounts/entities/account";
import { CollectionService } from "src/endpoints/collections/collection.service";
import { Fields } from "src/graphql/decorators/fields";
import { NftCollection } from "src/endpoints/collections/entities/nft.collection";
import { NftCollectionLoader } from "src/graphql/entities/nft.collection/nft.collection.loader";
import { NftCollectionQuery } from "src/graphql/entities/nft.collection/nft.collection.query";

@Resolver(() => NftCollection)
export class NftCollectionResolver extends NftCollectionQuery {
  constructor(
    private readonly nftCollectionLoader: NftCollectionLoader,
    collectionService: CollectionService
  ) {
    super(collectionService);
  }

  @ResolveField("owner", () => Account, { name: "owner", description: "Owner account for the given NFT collection.", nullable: true })
  public async getNftOwner(@Parent() nftCollection: NftCollection, @Fields() fields: Array<string>) {
    if (nftCollection.owner === undefined) {
      return null;
    }

    if (!fields.filter((field) => field !== "address").length) {
      // ask only for address

      return new Account({
        address: nftCollection.owner,
      });
    }

    return await this.nftCollectionLoader.getAccount(nftCollection.owner);
  }
}
