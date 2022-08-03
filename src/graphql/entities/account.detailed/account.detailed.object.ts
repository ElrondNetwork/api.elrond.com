import { ObjectType, OmitType } from "@nestjs/graphql";

import { NftAccount } from "src/endpoints/nfts/entities/nft.account";
import { NftCollectionAccount } from "src/endpoints/collections/entities/nft.collection.account";

@ObjectType()
export class NftAccountFlat extends OmitType(NftAccount, [
  "collection",
  "creator",
  "owner",
] as const) {}

@ObjectType()
export class NftCollectionAccountFlat extends OmitType(NftCollectionAccount, [
  "owner",
] as const) {}
