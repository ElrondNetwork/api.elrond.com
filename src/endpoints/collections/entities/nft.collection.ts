import { ApiProperty } from "@nestjs/swagger";
import { TokenAssets } from "src/endpoints/tokens/entities/token.assets";
import { NftType } from "../../nfts/entities/nft.type";
import { CollectionRoleForAddress } from "src/endpoints/tokens/entities/collection.role.for.address";

export class NftCollection {
  @ApiProperty()
  collection: string = '';

  @ApiProperty()
  type: NftType = NftType.NonFungibleESDT;

  @ApiProperty()
  name: string = '';

  @ApiProperty()
  ticker: string = '';

  @ApiProperty()
  owner: string | undefined = undefined;

  @ApiProperty()
  timestamp: number = 0;

  @ApiProperty()
  canFreeze: boolean = false;

  @ApiProperty()
  canWipe: boolean = false;

  @ApiProperty()
  canPause: boolean = false;

  @ApiProperty()
  canTransferNftCreateRole: boolean = false;

  @ApiProperty()
  decimals: number | undefined = undefined;

  @ApiProperty()
  assets: TokenAssets | undefined = undefined;

  @ApiProperty()
  roles: CollectionRoleForAddress[] = [];
}
