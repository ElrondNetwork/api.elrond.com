import { Field, Float, ID, InputType } from "@nestjs/graphql";

import { EsdtDataSource } from "src/endpoints/esdt/entities/esdt.data.source";
import { NftType } from "src/endpoints/nfts/entities/nft.type";

@InputType({ description: "Input to retrieve the given detailed account for." })
export class GetAccountDetailedInput {
  @Field(() => ID, { name: "address", description: "Address to retrieve the corresponding detailed account for." })
  address: string = "";

  public static resolve(input: GetAccountDetailedInput): string {
    return input.address;
  }
}

@InputType({ description: "Input to retrieve the given NFT collections account for." })
export class GetNftCollectionsAccountInput {
  @Field(() => Float, { name: "from", description: "Number of NFT collections to skip for the given result set.", nullable: true, defaultValue: 0 })
  from: number = 0;

  @Field(() => Float, { name: "size", description: "Number of NFT collections to retrieve for the given result set.", nullable: true, defaultValue: 25 })
  size: number = 25;

  @Field(() => ID, { name: "search", description: "Collection identifier to retrieve for the given result set.", nullable: true })
  search: string | undefined = undefined;

  @Field(() => [NftType], { name: "type", description: "NFT types list to retrieve for the given result set.", nullable: true })
  type: Array<NftType> | undefined = undefined;
}

@InputType({ description: "Input to retrieve the given NFTs account for." })
export class GetNftsAccountInput {
  @Field(() => Float, { name: "from", description: "Number of collections to skip for the given result set.", nullable: true, defaultValue: 0 })
  from: number = 0;

  @Field(() => Float, { name: "size", description: "Number of collections to retrieve for the given result set.", nullable: true, defaultValue: 25 })
  size: number = 25;

  @Field(() => String, { name: "search", description: "NFT identifier to retrieve for the given result set.", nullable: true })
  search: string | undefined = undefined;

  @Field(() => [ID], { name: "identifiers", description: "NFT comma-separated identifiers list to retrieve for the given result set.", nullable: true })
  identifiers: Array<string> | undefined = undefined;

  @Field(() => NftType, { name: "type", description: "NFT type to retrieve for the given result set.", nullable: true })
  type: NftType | undefined = undefined;

  @Field(() => [String], { name: "collections", description: "Collections to retrieve for the given result set.", nullable: true })
  collections: Array<string> | undefined = undefined;

  @Field(() => String, { name: "name", description: "Name to retrieve for the given result set.", nullable: true })
  name: string | undefined = undefined;

  @Field(() => [String], { name: "tags", description: "Tags list to retrieve for the given result set.", nullable: true })
  tags: Array<string> | undefined = undefined;

  @Field(() => String, { name: "creator", description: "Creator to retrieve for the given result set.", nullable: true })
  creator: string | undefined = undefined;

  @Field(() => Boolean, { name: "hasUris", description: "Has URIs to retrieve for the given result set.", nullable: true })
  hasUris: boolean | undefined = undefined;

  @Field(() => Boolean, { name: "includeFlagged", description: "Include flagged to retrieve for the given result set.", nullable: true })
  includeFlagged: boolean | undefined = undefined;

  @Field(() => Boolean, { name: "withSupply", description: "With supply to retrieve for the given result set.", nullable: true })
  withSupply: boolean | undefined = undefined;

  @Field(() => EsdtDataSource, { name: "source", description: "Source to retrieve for the given result set.", nullable: true })
  source: EsdtDataSource | undefined = undefined;
}
