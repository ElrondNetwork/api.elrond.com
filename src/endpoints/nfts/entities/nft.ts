import { ApiProperty } from "@nestjs/swagger";
import { ScamInfo } from "src/common/entities/scam-info.dto";
import { TokenAssets } from "src/common/assets/entities/token.assets";
import { NftMedia } from "./nft.media";
import { NftMetadata } from "./nft.metadata";
import { NftType } from "./nft.type";
import { SwaggerUtils } from "@elrondnetwork/erdnest";
import { Field, Float, ID, ObjectType } from "@nestjs/graphql";
import { NftCollection } from "src/endpoints/collections/entities/nft.collection";
import { UnlockMileStoneModel } from "../../../common/entities/unlock-schedule";
import { Account } from "src/endpoints/accounts/entities/account";

@ObjectType("Nft", { description: "NFT object type." })
export class Nft {
  constructor(init?: Partial<Nft>) {
    Object.assign(this, init);
  }

  @Field(() => ID, { description: "Identifier for the given NFT." })
  @ApiProperty({ type: String })
  identifier: string = '';

  @Field(() => NftCollection, { description: "NFT collection for the given NFT." })
  @ApiProperty({ type: String })
  collection: string = '';

  @Field(() => Float, { description: "Timestamp for the given NFT.", nullable: true })
  @ApiProperty({ type: Number, nullable: true })
  timestamp?: number = undefined;

  @Field(() => String, { description: "Attributes for the given NFT.", nullable: true })
  @ApiProperty({ type: String })
  attributes: string = '';

  @Field(() => Float, { description: "Nonce for the given NFT." })
  @ApiProperty({ type: Number })
  nonce: number = 0;

  @Field(() => NftType, { description: "NFT type for the given NFT." })
  @ApiProperty({ enum: NftType })
  type: NftType = NftType.NonFungibleESDT;

  @Field(() => String, { description: "Name for the given NFT." })
  @ApiProperty({ type: String })
  name: string = '';

  @Field(() => Account, { description: "Creator account for the given NFT." })
  @ApiProperty({ type: String })
  creator: string = '';

  @Field(() => Float, { description: "Royalties for the given NFT.", nullable: true })
  @ApiProperty({ type: Number, nullable: true })
  royalties: number | undefined = undefined;

  @Field(() => [String], { description: "URIs for the given NFT." })
  @ApiProperty({ isArray: true })
  uris: string[] = [];

  @Field(() => String, { description: "URL for the given NFT." })
  @ApiProperty({ type: String })
  url: string = '';

  @Field(() => [NftMedia], { description: "NFT media for the given NFT.", nullable: true })
  @ApiProperty({ type: NftMedia, nullable: true })
  media: NftMedia[] | undefined = undefined;

  @Field(() => Boolean, { description: "Is whitelisted storage for the given NFT." })
  @ApiProperty({ type: Boolean, default: false })
  isWhitelistedStorage: boolean = false;

  @Field(() => String, { description: "Thumbnail URL for the given NFT." })
  @ApiProperty({ type: String })
  thumbnailUrl: string = '';

  @Field(() => [String], { description: "Tags for the given NFT." })
  @ApiProperty({ isArray: true })
  tags: string[] = [];

  @Field(() => NftMetadata, { description: "Metadata for the given NFT.", nullable: true })
  @ApiProperty({ type: NftMetadata, nullable: true })
  metadata: NftMetadata | undefined = undefined;

  @Field(() => Account, { description: "Owner account for the given NFT.", nullable: true })
  @ApiProperty({ type: String, nullable: true })
  owner: string | undefined = undefined;

  @Field(() => String, { description: "Balance for the given NFT.", nullable: true })
  @ApiProperty({ type: String, nullable: true })
  balance: string | undefined = undefined;

  @Field(() => String, { description: "Supply for the given NFT.", nullable: true })
  @ApiProperty(SwaggerUtils.amountPropertyOptions())
  supply: string | undefined = undefined;

  @Field(() => Float, { description: "Decimals for the given NFT.", nullable: true })
  @ApiProperty({ type: Number, nullable: true })
  decimals: number | undefined = undefined;

  @Field(() => TokenAssets, { description: "Assets for the given NFT.", nullable: true })
  @ApiProperty()
  assets?: TokenAssets;

  @Field(() => String, { description: "Ticker for the given NFT." })
  @ApiProperty({ type: String })
  ticker?: string = '';

  @Field(() => ScamInfo, { description: "Scam information for the given NFT.", nullable: true })
  @ApiProperty({ type: ScamInfo, nullable: true })
  scamInfo: ScamInfo | undefined = undefined;

  @Field(() => Float, { description: "Score for the given NFT.", nullable: true })
  @ApiProperty({ type: Number, nullable: true })
  score: number | undefined = undefined;

  @Field(() => Float, { description: "Rank for the given NFT.", nullable: true })
  @ApiProperty({ type: Number, nullable: true })
  rank: number | undefined = undefined;

  @Field(() => Boolean, { description: "Is NSFW for the given NFT.", nullable: true })
  @ApiProperty({ type: Boolean, nullable: true })
  isNsfw: boolean | undefined = undefined;

  @Field(() => [UnlockMileStoneModel], { description: "Unlock mile stone model for the given NFT.", nullable: true })
  @ApiProperty({ type: [UnlockMileStoneModel], nullable: true })
  unlockSchedule?: UnlockMileStoneModel[] | undefined = undefined;
}
