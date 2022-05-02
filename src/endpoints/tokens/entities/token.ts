import { ApiProperty } from "@nestjs/swagger";
import { SwaggerUtils } from "src/utils/swagger.utils";
import { TokenAssets } from "./token.assets";

export class Token {
  @ApiProperty({ type: String })
  identifier: string = '';

  @ApiProperty({ type: String })
  name: string = '';

  @ApiProperty({ type: String })
  ticker: string = '';

  @ApiProperty({ type: String })
  owner: string = '';

  @ApiProperty(SwaggerUtils.amountPropertyOptions())
  minted: string = '';

  @ApiProperty(SwaggerUtils.amountPropertyOptions())
  burnt: string = '';

  @ApiProperty(SwaggerUtils.amountPropertyOptions())
  initialMinted: string = '';

  @ApiProperty({ type: Number })
  decimals: number = 0;

  @ApiProperty({ type: Boolean, default: false })
  isPaused: boolean = false;

  @ApiProperty({ type: TokenAssets, nullable: true })
  assets: TokenAssets | undefined = undefined;

  @ApiProperty({ type: Number, nullable: true })
  transactions: number | undefined = undefined;

  @ApiProperty({ type: Number, nullable: true })
  accounts: number | undefined = undefined;

  @ApiProperty()
  canUpgrade: boolean = false;

  @ApiProperty()
  canMint: boolean = false;

  @ApiProperty()
  canBurn: boolean = false;

  @ApiProperty()
  canChangeOwner: boolean = false;

  @ApiProperty()
  canPause: boolean = false;

  @ApiProperty()
  canFreeze: boolean = false;

  @ApiProperty()
  canWipe: boolean = false;
}
