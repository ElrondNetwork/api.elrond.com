import { Field, Float, ObjectType } from "@nestjs/graphql";
import { ApiProperty } from "@nestjs/swagger";
import { NftCollection } from "./nft.collection";

@ObjectType("NftCollectionAccount", { description: "NFT collection account object type." })
export class NftCollectionAccount extends NftCollection {
  constructor(init?: Partial<NftCollectionAccount>) {
    super();
    Object.assign(this, init);
  }

  @Field(() => Float, { description: 'Count for the given NFT collection account.' })
  @ApiProperty()
  count: number = 0;
}
