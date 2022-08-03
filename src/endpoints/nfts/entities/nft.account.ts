import { Field, Float, ObjectType } from "@nestjs/graphql";
import { ApiProperty } from "@nestjs/swagger";
import { Nft } from "./nft";

@ObjectType("NftAccount", { description: "NFT account object type." })
export class NftAccount extends Nft {
  constructor(init?: Partial<NftAccount>) {
    super();
    Object.assign(this, init);
  }

  @Field(() => String, { description: "Balance for the given NFT account." })
  @ApiProperty({ type: String, example: 10 })
  balance: string = '';

  @Field(() => Float, { description: "Price for the given NFT account.", nullable: true })
  @ApiProperty({ type: Number, nullable: true })
  price: number | undefined = undefined;

  @Field(() => Float, { description: "Value in USD for the given NFT account.", nullable: true })
  @ApiProperty({ type: Number, nullable: true })
  valueUsd: number | undefined = undefined;
}
