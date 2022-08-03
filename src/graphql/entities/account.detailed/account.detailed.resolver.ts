import { Resolver, ResolveField, Parent, Float, Args } from "@nestjs/graphql";

import { AccountDetailed } from "src/endpoints/accounts/entities/account.detailed";
import { AccountDetailedQuery } from "src/graphql/entities/account.detailed/account.detailed.query";
import { AccountService } from "src/endpoints/accounts/account.service";
import { CollectionFilter } from "src/endpoints/collections/entities/collection.filter";
import { CollectionService } from "src/endpoints/collections/collection.service";
import { GetNftCollectionsAccountInput, GetNftsAccountInput } from "src/graphql/entities/account.detailed/account.detailed.input";
import { NftAccountFlat, NftCollectionAccountFlat } from "src/graphql/entities/account.detailed/account.detailed.object";import { NftFilter } from "src/endpoints/nfts/entities/nft.filter";
import { NftService } from "src/endpoints/nfts/nft.service";
import { NftQueryOptions } from "src/endpoints/nfts/entities/nft.query.options";
import { QueryPagination } from "src/common/entities/query.pagination";

@Resolver(() => AccountDetailed)
export class AccountDetailedResolver extends AccountDetailedQuery {
  constructor(
    protected readonly nftService: NftService,
    protected readonly collectionService: CollectionService,
    accountService: AccountService
  ) {
    super(accountService);
  }

  // from AccountDetailed

  @ResolveField("txCount", () => Float, { name: "txCount", description: "Transactions count for the given detailed account." })
  public async getAccountDetailedTransactionCount(@Parent() account: AccountDetailed) {
    return await this.accountService.getAccountTxCount(account.address);
  }

  @ResolveField("scrCount", () => Float, { name: "scrCount", description: "Smart contracts count for the given detailed account." })
  public async getAccountDetailedSmartContractCount(@Parent() account: AccountDetailed) {
    return await this.accountService.getAccountScResults(account.address);
  }

  @ResolveField("nftCollections", () => [NftCollectionAccountFlat], { name: "nftCollections", description: "NFT collections account for the given detailed account.", nullable: true })
  public async getAccountDetailedNftCollections(@Args("input", { description: "Input to retrieve the given NFT collections account for." }) input: GetNftCollectionsAccountInput, @Parent() account: AccountDetailed) {
    return await this.collectionService.getCollectionsForAddress(
      account.address, 
      new CollectionFilter({ 
        search: input.search, 
        type: input.type, 
      }), 
      new QueryPagination({ 
        from: input.from, 
        size: input.size, 
      })
    );
  }

  @ResolveField("nfts", () => [NftAccountFlat], { name: "nfts", description: "NFTs account for the given detailed account.", nullable: true })
  public async getAccountDetailedNfts(@Args("input", { description: "Input to retrieve the given NFTs account for." }) input: GetNftsAccountInput, @Parent() account: AccountDetailed) {
    return await this.nftService.getNftsForAddress(
      account.address,
      new QueryPagination({ 
        from: input.from, 
        size: input.size, 
      }),
      new NftFilter({ 
        search: input.search, 
        identifiers: input.identifiers, 
        type: input.type, 
        name: input.name, 
        collections: input.collections, 
        tags: input.tags, 
        creator: input.creator, 
        hasUris: input.hasUris, 
        includeFlagged: input.includeFlagged, 
      }),
      new NftQueryOptions({ 
        withSupply: input.withSupply, 
      }),
      input.source
    );
  }
}
