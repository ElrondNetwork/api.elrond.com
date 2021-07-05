import { Injectable, Logger } from "@nestjs/common";
import { ApiConfigService } from "src/helpers/api.config.service";
import { CachingService } from "src/helpers/caching.service";
import { GatewayService } from "src/helpers/gateway.service";
import { bech32Decode, bech32Encode, mergeObjects, oneDay, oneHour } from "src/helpers/helpers";
import { VmQueryService } from "src/endpoints/vm.query/vm.query.service";
import { Token } from "./entities/token";
import { TokenWithBalance } from "./entities/token.with.balance";
import { TokenDetailed } from "./entities/token.detailed";
import { NftDetailed } from "./entities/nft.detailed";
import { NftType } from "./entities/nft.type";
import { ElasticService } from "src/helpers/elastic.service";
import { NftElastic } from "./entities/nft.elastic";
import { NftElasticDetailed } from "./entities/nft.elastic.detailed";
import { NftElasticOwner } from "./entities/nft.elastic.owner";
import { NftElasticAccount } from "./entities/nft.elastic.account";
import { TokenAssetService } from "src/helpers/token.asset.service";

@Injectable()
export class TokenService {
  private readonly logger: Logger

  constructor(
    private readonly gatewayService: GatewayService, 
    private readonly apiConfigService: ApiConfigService,
    private readonly cachingService: CachingService,
    private readonly vmQueryService: VmQueryService,
    private readonly elasticService: ElasticService,
    private readonly tokenAssetService: TokenAssetService
  ) {
    this.logger = new Logger(TokenService.name);
  }

  async getToken(identifier: string): Promise<TokenDetailed | undefined> {
    let tokens = await this.getAllTokens();
    let token = tokens.find(x => x.token === identifier);
    if (token) {
      token.assets = await this.tokenAssetService.getAssets(token.token);

      return mergeObjects(new TokenDetailed(), token);
    }

    return undefined;
  }

  async getTokens(from: number, size: number, search: string | undefined): Promise<TokenDetailed[]> {
    let tokens = await this.getAllTokens();

    if (search) {
      let searchLower = search.toLowerCase();

      tokens = tokens.filter(token => token.name.toLowerCase().includes(searchLower) || token.token.toLowerCase().includes(searchLower));
    }

    tokens = tokens.slice(from, from + size);

    for (let token of tokens) {
      token.assets = await this.tokenAssetService.getAssets(token.token);
    }

    return tokens.map(item => mergeObjects(new TokenDetailed(), item));
  }

  async getTokenCount(): Promise<number> {
    let allTokens = await this.getAllTokens();
    return allTokens.length;
  }

  async getNft(identifier: string): Promise<NftDetailed | undefined> {
    let nfts = await this.getAllNfts();
    let nft = nfts.find(x => x.token === identifier);
    if (nft) {
      return mergeObjects(new NftDetailed(), nft);
    }

    return nft;
  }

  async getNfts(from: number, size: number, search: string | undefined, type: NftType | undefined, token: string | undefined, tags: string | undefined, creator: string | undefined): Promise<NftElastic[]> {
    return await this.getNftsInternal(from, size, search, type, undefined, token, tags, creator);
  }

  async getSingleNft(identifier: string): Promise<NftElasticDetailed | undefined> {
    let nfts = await this.getNftsInternal(0, 1, undefined, undefined, identifier, undefined, undefined, undefined);
    if (nfts.length === 0) {
      return undefined;
    }

    let nft: NftElasticDetailed = mergeObjects(new NftElasticDetailed(), nfts[0]);

    let accountsEsdt = await this.elasticService.getAccountEsdtByIdentifier(nft.identifier);
    if (nft.type === NftType.NonFungibleESDT) {
      nft.owner = accountsEsdt[0].address;
      
      // @ts-ignore
      delete nft.owners;
    } else {
      nft.owners = accountsEsdt.map((esdt: any) => {
        let owner = new NftElasticOwner();
        owner.address = esdt.address;
        owner.balance = esdt.balance;

        return owner;
      });

      // @ts-ignore
      delete nft.owner;
    }

    // let gatewayNft = await this.getNft(nft.token);
    // if (!gatewayNft) {
    //   throw new Error(`Could not get NFT token details for token '${nft.token}'`);
    // }

    // mergeObjects(nft, gatewayNft);

    return nft;
  }

  async getNftsInternal(from: number, size: number, search: string | undefined, type: NftType | undefined, identifier: string | undefined, token: string | undefined, tags: string | undefined, creator: string | undefined): Promise<NftElastic[]> {
    let tagArray: string[] = [];
    if (tags !== undefined) {
      tagArray = tags.split(',');
    }

    let elasticNfts = await this.elasticService.getTokens(from, size, search, type, identifier, token, tagArray, creator);
    let nfts: NftElastic[] = [];

    for (let elasticNft of elasticNfts) {
      let nft = new NftElastic();
      nft.identifier = elasticNft.identifier;
      nft.token = elasticNft.token;
      nft.type = elasticNft.type;
      nft.timestamp = elasticNft.timestamp;
      nft.nonce = parseInt('0x' + nft.identifier.split('-')[2]);
      
      let metadata = elasticNft.metaData;
      if (metadata) {
        nft.name = metadata.name;
        nft.creator = metadata.creator;
        nft.royalties = metadata.royalties / 10000; // 10.000 => 100%
        nft.hash = metadata.hash;
        nft.uris = metadata.uris.filter((x: any) => x);
        nft.url = metadata.uris[0];

        if (metadata.attributes && metadata.attributes.tags) {
          nft.tags = metadata.attributes.tags;
        }
      }

      nfts.push(nft);
    }

    for (let nft of nfts) {
      let gatewayNft = await this.getNft(nft.identifier);
      if (gatewayNft) {
        mergeObjects(nft, gatewayNft);
      }
    }

    return nfts;
  }

  async getNftCount(): Promise<number> {
    return await this.elasticService.getTokenCount();
  }
  
  async getTokenCountForAddress(address: string): Promise<number> {
    let tokens = await this.getAllTokensForAddress(address);
    return tokens.length;
  }

  async getTokensForAddress(address: string, from: number, size: number): Promise<TokenWithBalance[]> {
    let tokens = await this.getAllTokensForAddress(address);

    tokens = tokens.slice(from, from + size);

    for (let token of tokens) {
      token.assets = await this.tokenAssetService.getAssets(token.token);
    }

    return tokens.map(token => mergeObjects(new TokenWithBalance(), token));
  }

  async getTokenForAddress(address: string, tokenIdentifier: string): Promise<TokenWithBalance | undefined> {
    let allTokens = await this.getAllTokensForAddress(address);

    let foundToken = allTokens.find(x => x.token === tokenIdentifier);
    if (!foundToken) {
      return undefined;
    }

    foundToken.assets = await this.tokenAssetService.getAssets(tokenIdentifier);

    return foundToken;
  }

  async getAllTokensForAddress(address: string): Promise<TokenWithBalance[]> {
    let tokens = await this.getAllTokens();

    let tokensIndexed: { [index: string]: Token } = {};
    for (let token of tokens) {
      tokensIndexed[token.token] = token;
    }

    let esdtResult = await this.gatewayService.get(`address/${address}/esdt`);

    let tokensWithBalance: TokenWithBalance[] = [];

    for (let tokenIdentifier of Object.keys(esdtResult.esdts)) {
      if (!this.isEsdt(tokenIdentifier)) {
        continue;
      }

      let esdt = esdtResult.esdts[tokenIdentifier];
      let token = tokensIndexed[tokenIdentifier];
      if (!token) {
        this.logger.log(`Could not find token with identifier ${tokenIdentifier}`);
        continue;
      }

      let tokenWithBalance = {
        ...token,
        ...esdt,
      };

      tokensWithBalance.push(tokenWithBalance);
    }

    for (let token of tokensWithBalance) {
      // @ts-ignore
      token.identifier = token.tokenIdentifier;
      // @ts-ignore
      delete token.tokenIdentifier;
    }

    return tokensWithBalance;
  }

  isEsdt(tokenIdentifier: string) {
    return tokenIdentifier.split('-').length === 2;
  }

  getNftGlobalIdentifier(tokenIdentifier: string) {
    let parts = tokenIdentifier.split('-');
    parts.length = 2;
    return parts.join('-');
  }

  async getNftCountForAddress(address: string): Promise<number> {
    return await this.elasticService.getAccountEsdtByAddressCount(address);
  }

  async getNftsForAddress(address: string, from: number, size: number, token: string | undefined): Promise<NftElasticAccount[]> {
    let elasticNfts = await this.elasticService.getAccountEsdtByAddress(address, from, size, token);

    let nfts: NftElasticAccount[] = [];

    for (let elasticNft of elasticNfts) {
      let nft = new NftElasticAccount();
      nft.identifier = elasticNft.identifier;
      nft.token = elasticNft.token;
      nft.nonce = parseInt('0x' + elasticNft.identifier.split('-')[2]);
      
      let metadata = elasticNft.metaData;
      if (metadata) {
        nft.name = metadata.name;
        nft.creator = metadata.creator;
        nft.royalties = metadata.royalties / 10000; // 10.000 => 100%
        nft.hash = metadata.hash;
        nft.uris = metadata.uris.filter((x: any) => x);
        nft.url = metadata.uris[0];

        if (metadata.attributes && metadata.attributes.tags) {
          nft.tags = metadata.attributes.tags;
        }
      }

      nfts.push(nft);
    }

    if (nfts.length > 0) {
      let identifiers = nfts.map(x => x.identifier);
      let tokens = await this.elasticService.getTokensByIdentifiers(identifiers);

      for (let token of tokens) {
        let nft = nfts.find(x => x.identifier === token.identifier);
        if (!nft) {
          throw new Error(`Could not identify NFT with identifier '${token.identifier}' in elastic tokens by identifiers`);
        }

        nft.type = token.type;
        nft.timestamp = token.timestamp;
      }
    }

    for (let nft of nfts) {
      let gatewayNft = await this.getNft(nft.identifier);
      if (gatewayNft) {
        mergeObjects(nft, gatewayNft);
      }
    }

    let nftAccounts: NftElasticAccount[] = [];
    for (let elasticNft of elasticNfts) {
      let nft = nfts.find(x => x.identifier === elasticNft.identifier);
      if (!nft) {
        throw new Error(`Could not identify NFT with identifier '${elasticNft.identifier}' in NFT array`);
      }

      if (nft.type === NftType.NonFungibleESDT) {
        // @ts-ignore
        delete nft.balance;
      } else if (nft.type === NftType.SemiFungibleESDT) {
        nft.balance = elasticNft.balance;
      }

      nftAccounts.push(nft);
    }

    return nftAccounts;
  }

  async getNftForAddress(address: string, identifier: string): Promise<NftElasticAccount | undefined> {
    // search in elastic accountsesdt by address and identifier
    // if not found, return undefined
    let accountEsdt = await this.elasticService.getAccountEsdtByAddressAndIdentifier(address, identifier);
    if (!accountEsdt) {
      return undefined;
    }

    let nft = new NftElasticAccount();
    nft.identifier = accountEsdt.identifier;
    nft.token = accountEsdt.token;
    nft.nonce = parseInt('0x' + accountEsdt.identifier.split('-')[2]);
    
    let metadata = accountEsdt.metaData;
    if (metadata) {
      nft.name = metadata.name;
      nft.creator = metadata.creator;
      nft.royalties = metadata.royalties / 10000; // 10.000 => 100%
      nft.hash = metadata.hash;
      nft.uris = metadata.uris.filter((x: any) => x);
      nft.url = metadata.uris[0];

      if (metadata.attributes && metadata.attributes.tags) {
        nft.tags = metadata.attributes.tags;
      }
    }

    // search in elastic tokens by identifier; set type & timestamp
    let token = await this.elasticService.getTokenByIdentifier(accountEsdt.identifier);
    if (!token) {
      return undefined;
    }

    nft.type = token.type;
    nft.timestamp = token.timestamp;

    let gatewayNft = await this.getNft(nft.token);
    if (!gatewayNft) {
      return undefined;
    }

    mergeObjects(nft, gatewayNft);

    if (nft.type === NftType.NonFungibleESDT) {
      // @ts-ignore
      delete nft.balance;
    } else if (nft.type === NftType.SemiFungibleESDT) {
      // search in gateway by address (and identifier?); set balance
      let nonceHex = nft.identifier.split('-')[2];
      if (!nonceHex) {
        return undefined;
      }

      let nonce = parseInt('0x' + nonceHex);
      if (isNaN(nonce)) {
        return undefined;
      }

      let nftGatewayResult = await this.gatewayService.get(`address/${address}/nft/${nft.token}/nonce/${nonce}`);
      if (!nftGatewayResult || !nftGatewayResult.tokenData || !nftGatewayResult.tokenData.balance) {
        return undefined;
      }

      nft.balance = nftGatewayResult.tokenData.balance;
    } else {
      throw new Error(`Unrecognized NFT Type '${nft.type}'`);
    }

    return nft;
  }

  async getAllNftsForAddress(address: string): Promise<Token[]> {
    let nfts = await this.getAllNfts();

    let tokensIndexed: { [index: string]: Token } = {};
    for (let token of nfts) {
      tokensIndexed[token.token] = token;
    }

    let esdtResult = await this.gatewayService.get(`address/${address}/esdt`);

    let tokensWithBalance: TokenWithBalance[] = [];

    for (let tokenIdentifier of Object.keys(esdtResult.esdts)) {
      if (this.isEsdt(tokenIdentifier)) {
        continue;
      }

      let nftIdentifier = this.getNftGlobalIdentifier(tokenIdentifier);

      let esdt = esdtResult.esdts[tokenIdentifier];
      let token = tokensIndexed[nftIdentifier];
      if (!token) {
        this.logger.log(`Could not find token with identifier ${nftIdentifier}`);
        continue;
      }

      let tokenWithBalance = {
        ...token,
        ...esdt,
      };

      tokensWithBalance.push(tokenWithBalance);
    }

    for (let token of tokensWithBalance) {
      // @ts-ignore
      token.identifier = token.tokenIdentifier;
      // @ts-ignore
      delete token.tokenIdentifier;
    }

    return tokensWithBalance;
  }

  async getStakeForAddress(address: string) {
    const [totalStakedEncoded, unStakedTokensListEncoded] = await Promise.all([
      this.vmQueryService.vmQuery(
        this.apiConfigService.getAuctionContractAddress(),
        'getTotalStaked',
        address,
      ),
      this.vmQueryService.vmQuery(
        this.apiConfigService.getAuctionContractAddress(),
        'getUnStakedTokensList',
        address,
        [ bech32Decode(address) ],
      ),
    ]);

    const data: any = {
      totalStaked: '0',
      unstakedTokens: undefined,
    };

    if (totalStakedEncoded) {
      data.totalStaked = Buffer.from(totalStakedEncoded[0], 'base64').toString('ascii');
    }

    if (unStakedTokensListEncoded) {
      data.unstakedTokens = unStakedTokensListEncoded.reduce((result: any, _, index, array) => {
        if (index % 2 === 0) {
          const [encodedAmount, encodedEpochs] = array.slice(index, index + 2);

          const amountHex = Buffer.from(encodedAmount, 'base64').toString('hex');
          const amount = BigInt(amountHex ? '0x' + amountHex : amountHex).toString();

          const epochsHex = Buffer.from(encodedEpochs, 'base64').toString('hex');
          const epochs = parseInt(BigInt(epochsHex ? '0x' + epochsHex : epochsHex).toString());

          result.push({ amount, epochs });
        }

        return result;
      }, []);

      const networkConfig = await this.getNetworkConfig();

      for (const element of data.unstakedTokens) {
        element.expires = element.epochs
          ? this.getExpires(element.epochs, networkConfig.roundsPassed, networkConfig.roundsPerEpoch, networkConfig.roundDuration)
          : undefined;
        delete element.epochs;
      }
    }

    return data;
  }

  getExpires(epochs: number, roundsPassed: number, roundsPerEpoch: number, roundDuration: number) {
    const now = Math.floor(Date.now() / 1000);
  
    if (epochs === 0) {
      return now;
    }
  
    const fullEpochs = (epochs - 1) * roundsPerEpoch * roundDuration;
    const lastEpoch = (roundsPerEpoch - roundsPassed) * roundDuration;
  
    // this.logger.log('expires', JSON.stringify({ epochs, roundsPassed, roundsPerEpoch, roundDuration }));
  
    return now + fullEpochs + lastEpoch;
  };

  async getNetworkConfig() {
    const [
      {
        config: { erd_round_duration, erd_rounds_per_epoch },
      },
      {
        status: { erd_rounds_passed_in_current_epoch },
      },
    ] = await Promise.all([
      this.gatewayService.get('network/config'),
      this.gatewayService.get('network/status/4294967295')
    ]);
  
    const roundsPassed = erd_rounds_passed_in_current_epoch;
    const roundsPerEpoch = erd_rounds_per_epoch;
    const roundDuration = erd_round_duration / 1000;
  
    return { roundsPassed, roundsPerEpoch, roundDuration };
  };

  async getAllTokens(): Promise<TokenDetailed[]> {
    return this.cachingService.getOrSetCache(
      'allTokens',
      async () => await this.getAllTokensRaw(),
      oneHour()
    );
  }

  async getAllTokensRaw(): Promise<TokenDetailed[]> {
    const {
      tokens: tokensIdentifiers,
    } = await this.gatewayService.get('network/esdt/fungible-tokens');

    let tokens = await this.cachingService.batchProcess(
      tokensIdentifiers,
      token => `tokenProperties:${token}`,
      async (token: string) => await this.getTokenProperties(token),
      oneDay()
    );

    // @ts-ignore
    return tokens;
  }

  async getAllNfts(): Promise<Token[]> {
    return this.cachingService.getOrSetCache(
      'allNfts',
      async () => await this.getAllNftsRaw(),
      oneHour()
    );
  }

  async getAllNftsRaw(): Promise<Token[]> {
    const {
      tokens: nftIdentifiers,
    } = await this.gatewayService.get('network/esdt/non-fungible-tokens');

    const {
      tokens: sftIdentifiers,
    } = await this.gatewayService.get('network/esdt/semi-fungible-tokens');

    let nfts = await this.cachingService.batchProcess(
      nftIdentifiers,
      token => `tokenProperties:${token}`,
      async (token: string) => await this.getTokenProperties(token),
      oneDay()
    );

    let sfts = await this.cachingService.batchProcess(
      sftIdentifiers,
      token => `tokenProperties:${token}`,
      async (token: string) => await this.getTokenProperties(token),
      oneDay()
    );

    // @ts-ignore
    return nfts.concat(...sfts);
  }

  async getTokenProperties(token: string) {
    const arg = Buffer.from(token, 'utf8').toString('hex');
  
    const tokenPropertiesEncoded = await this.vmQueryService.vmQuery(
      this.apiConfigService.getEsdtContractAddress(),
      'getTokenProperties',
      undefined,
      [ arg ],
      true
    );
  
    const tokenProperties = tokenPropertiesEncoded.map((encoded, index) =>
      Buffer.from(encoded, 'base64').toString(index === 2 ? 'hex' : undefined)
    );
  
    const [
      name,
      type,
      owner,
      minted,
      burnt,
      decimals,
      isPaused,
      canUpgrade,
      canMint,
      canBurn,
      canChangeOwner,
      canPause,
      canFreeze,
      canWipe,
      canAddSpecialRoles,
      canTransferNFTCreateRole,
      NFTCreateStopped,
      wiped,
    ] = tokenProperties;
  
    const tokenProps = {
      token,
      name,
      type,
      owner: bech32Encode(owner),
      minted,
      burnt,
      decimals: parseInt(decimals.split('-').pop() ?? '0'),
      isPaused: this.canBool(isPaused),
      canUpgrade: this.canBool(canUpgrade),
      canMint: this.canBool(canMint),
      canBurn: this.canBool(canBurn),
      canChangeOwner: this.canBool(canChangeOwner),
      canPause: this.canBool(canPause),
      canFreeze: this.canBool(canFreeze),
      canWipe: this.canBool(canWipe),
      canAddSpecialRoles: this.canBool(canAddSpecialRoles),
      canTransferNFTCreateRole: this.canBool(canTransferNFTCreateRole),
      NFTCreateStopped: this.canBool(NFTCreateStopped),
      wiped: wiped.split('-').pop(),
    };
  
    if (type === 'FungibleESDT') {
      // @ts-ignore
      delete tokenProps.canAddSpecialRoles;
      // @ts-ignore
      delete tokenProps.canTransferNFTCreateRole;
      // @ts-ignore
      delete tokenProps.NFTCreateStopped;
      delete tokenProps.wiped;
    }
  
    return tokenProps;
  };

  canBool(string: string) {
    return string.split('-').pop() === 'true';
  };
}