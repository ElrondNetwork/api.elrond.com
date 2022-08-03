import { Field, Float, ObjectType } from "@nestjs/graphql";
import { ApiProperty } from "@nestjs/swagger";
import { ScamInfo } from "src/common/entities/scam-info.dto";
import { NftCollectionAccount } from "src/endpoints/collections/entities/nft.collection.account";
import { NftAccount } from "src/endpoints/nfts/entities/nft.account";
import { Account } from "./account";

@ObjectType("AccountDetailed", { description: "Detailed Account object type that extends Account." })
export class AccountDetailed extends Account {
  constructor(init?: Partial<AccountDetailed>) {
    super();
    Object.assign(this, init);
  }

  @Field(() => String, { description: 'Code for the given detailed account.' })
  @ApiProperty({ description: 'The source code in hex format' })
  code: string = '';

  @Field(() => String, { description: 'Code hash for the given detailed account.', nullable: true })
  @ApiProperty({ description: 'The hash of the source code' })
  codeHash: string = '';

  @Field(() => String, { description: 'Root hash for the given detailed account.' , nullable: true })
  @ApiProperty({ description: 'The hash of the root node' })
  rootHash: string = '';

  @Field(() => Float, { description: 'Transactions count for the given detailed account.' })
  @ApiProperty({ description: 'The number of transactions performed on this account' })
  txCount: number = 0;

  @Field(() => Float, { description: 'Smart contract results count for the given detailed account.' })
  @ApiProperty({ description: 'The number of smart contract results of this account' })
  scrCount: number = 0;

  @Field(() => String, { description: 'Username for the given detailed account.' })
  @ApiProperty({ description: 'The username specific for this account' })
  username: string = '';

  @Field(() => String, { description: 'Developer reward for the given detailed account.' })
  @ApiProperty({ description: 'The developer reward' })
  developerReward: string = '';

  @Field(() => String, { description: 'Owner address for the given detailed account.' })
  @ApiProperty({ description: 'The address in bech 32 format of owner account' })
  ownerAddress: string = '';

  @Field(() => Float, { description: 'Deployment timestamp for the given detailed account.', nullable: true })
  @ApiProperty({ description: 'Specific property flag for smart contract', type: Number })
  deployedAt?: number;

  @Field(() => Boolean, { description: 'If the given detailed account is upgradeable.', nullable: true })
  @ApiProperty({ description: 'Specific property flag for smart contract', type: Boolean })
  isUpgradeable?: boolean;

  @Field(() => Boolean, { description: 'If the given detailed account is readable.', nullable: true })
  @ApiProperty({ description: 'Specific property flag for smart contract', type: Boolean })
  isReadable?: boolean;

  @Field(() => Boolean, { description: 'If the given detailed account is payable.', nullable: true })
  @ApiProperty({ description: 'Specific property flag for smart contract', type: Boolean })
  isPayable?: boolean;

  @Field(() => Boolean, { description: 'If the given detailed account is payable by smart contract.', nullable: true })
  @ApiProperty({ description: 'Specific property flag for smart contract', type: Boolean, nullable: true })
  isPayableBySmartContract?: boolean | undefined = undefined;

  @Field(() => ScamInfo, { description: 'Scam information for the given detailed account.', nullable: true })
  @ApiProperty({ type: ScamInfo, nullable: true })
  scamInfo: ScamInfo | undefined = undefined;

  @Field(() => [NftCollectionAccount], { description: 'NFT collections account for the given detailed account.', nullable: true })
  nftCollections: NftCollectionAccount[] | undefined = undefined;

  @Field(() => [NftAccount], { description: 'NFTs account for the given detailed account.', nullable: true })
  nfts: NftAccount[] | undefined = undefined;
}
