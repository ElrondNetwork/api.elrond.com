import { Parent, ResolveField, Resolver } from "@nestjs/graphql";

import { Account } from "src/endpoints/accounts/entities/account";
import { Fields } from "src/graphql/decorators/fields";
import { Nft } from "src/endpoints/nfts/entities/nft";
import { NftCollection } from "src/endpoints/collections/entities/nft.collection";
import { NftLoader } from "src/graphql/entities/nft/nft.loader";
import { NftService } from "src/endpoints/nfts/nft.service";
import { NftQuery } from "src/graphql/entities/nft/nft.query";

@Resolver(() => Nft)
export class NftResolver extends NftQuery {
  constructor(
    private readonly nftLoader: NftLoader,
    nftService: NftService
  ) {
    super(nftService);
  }

  @ResolveField("collection", () => NftCollection, { name: "collection", description: "NFT collection for the given NFT." })
  public async getNftCollection(@Parent() nft: Nft) {
    return await this.nftLoader.getCollection(nft.collection);
  }

  @ResolveField("creator", () => Account, { name: "creator", description: "Creator account for the given NFT." })
  public async getNftCreator(@Parent() nft: Nft, @Fields() fields: Array<string>) {
    if (!fields.filter((field) => field !== "address").length) {
      // ask only for address

      return new Account({
        address: nft.creator,
      });
    }

    return await this.nftLoader.getAccount(nft.creator);
  }

  @ResolveField("owner", () => Account, { name: "owner", description: "Owner account for the given NFT.", nullable: true })
  public async getNftOwner(@Parent() nft: Nft, @Fields() fields: Array<string>) {
    if (nft.owner === undefined) {
      return null;
    }

    if (!fields.filter((field) => field !== "address").length) {
      // ask only for address

      return new Account({
        address: nft.owner,
      });
    }

    return await this.nftLoader.getAccount(nft.owner);
  }
}
