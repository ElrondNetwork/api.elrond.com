import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { CacheInfo } from "src/utils/cache.info";
import { GatewayComponentRequest } from "src/common/gateway/entities/gateway.component.request";
import { TokenProperties } from "src/endpoints/tokens/entities/token.properties";
import { VmQueryService } from "src/endpoints/vm.query/vm.query.service";
import { TokenHelpers } from "src/utils/token.helpers";
import { ApiConfigService } from "../../common/api-config/api.config.service";
import { GatewayService } from "../../common/gateway/gateway.service";
import { MexTokenService } from "../mex/mex.token.service";
import { TokenAssets } from "../../common/assets/entities/token.assets";
import { TokenDetailed } from "../tokens/entities/token.detailed";
import { TokenRoles } from "../tokens/entities/token.roles";
import { AssetsService } from "../../common/assets/assets.service";
import { TransactionService } from "../transactions/transaction.service";
import { EsdtLockedAccount } from "./entities/esdt.locked.account";
import { EsdtSupply } from "./entities/esdt.supply";
import {
  AddressUtils,
  ApiUtils,
  BinaryUtils,
  Constants,
  NumberUtils,
  RecordUtils,
  CachingService,
  ElasticService,
  ElasticQuery,
  QueryConditionOptions,
  QueryType,
  QueryOperator,
  RangeGreaterThanOrEqual,
} from "@elrondnetwork/erdnest";
import { NftType } from '../nfts/entities/nft.type';
import { QueryPagination } from '../../common/entities/query.pagination';

@Injectable()
export class EsdtService {
  private readonly logger: Logger;

  constructor(
    private readonly gatewayService: GatewayService,
    private readonly apiConfigService: ApiConfigService,
    private readonly cachingService: CachingService,
    private readonly vmQueryService: VmQueryService,
    private readonly elasticService: ElasticService,
    @Inject(forwardRef(() => AssetsService))
    private readonly assetsService: AssetsService,
    @Inject(forwardRef(() => TransactionService))
    private readonly transactionService: TransactionService,
    private readonly mexTokenService: MexTokenService,
  ) {
    this.logger = new Logger(EsdtService.name);
  }

  async getAllEsdtAndMetaEsdtTokens(): Promise<TokenDetailed[]> {
    const [
      allEsdtAndMetaEsdtTokens,
      allMetaESDTCollections,
    ] = await Promise.all([
      this.getAllEsdtTokens(),
      this.getAllMetaESDTTokens(),
    ]);

    return [...allEsdtAndMetaEsdtTokens, ...allMetaESDTCollections];
  }

  async getAllEsdtTokens(): Promise<TokenDetailed[]> {
    return await this.cachingService.getOrSetCache(
      CacheInfo.AllEsdtTokens.key,
      async () => await this.getAllEsdtTokensRaw(),
      CacheInfo.AllEsdtTokens.ttl
    );
  }

  async getAllEsdtTokensRaw(): Promise<TokenDetailed[]> {
    let tokensIdentifiers: string[];
    try {
      const getFungibleTokensResult = await this.gatewayService.get('network/esdt/fungible-tokens', GatewayComponentRequest.allFungibleTokens);

      tokensIdentifiers = getFungibleTokensResult.tokens;
    } catch (error) {
      this.logger.error('Error when getting fungible tokens from gateway');
      this.logger.error(error);
      return [];
    }

    const tokensProperties = await this.cachingService.batchProcess(
      tokensIdentifiers,
      token => CacheInfo.EsdtProperties(token).key,
      async (identifier: string) => await this.getEsdtTokenPropertiesRaw(identifier),
      Constants.oneDay(),
      true
    );

    const tokensAssets = await this.cachingService.batchProcess(
      tokensIdentifiers,
      token => CacheInfo.EsdtAssets(token).key,
      async (identifier: string) => await this.getEsdtTokenAssetsRaw(identifier),
      Constants.oneDay(),
      true
    );

    let tokens = tokensProperties.zip(tokensAssets, (first, second) => ApiUtils.mergeObjects(new TokenDetailed, { ...first, assets: second }));

    await this.batchProcessTokens(tokens);

    await this.applyMexPrices(tokens);

    tokens = tokens.sortedDescending(token => token.assets ? 1 : 0, token => token.marketCap ?? 0, token => token.transactions ?? 0);

    return tokens;
  }

  async applyMexPrices(tokens: TokenDetailed[]): Promise<void> {
    try {
      const indexedTokens = await this.mexTokenService.getMexPricesRaw();
      for (const token of tokens) {
        const price = indexedTokens[token.identifier];
        if (price) {
          const supply = await this.getTokenSupply(token.identifier);

          if (token.assets && token.identifier.split('-')[0] === 'EGLDUSDC') {
            price.price = price.price / (10 ** 12) * 2;
          }

          if (price.isToken) {
            token.price = price.price;
            token.marketCap = price.price * NumberUtils.denominateString(supply.circulatingSupply, token.decimals);
          }

          token.supply = supply.totalSupply;
          token.circulatingSupply = supply.circulatingSupply;
        }
      }
    } catch (error) {
      this.logger.error('Could not apply mex tokens prices');
      this.logger.error(error);
    }
  }

  async batchProcessTokens(tokens: TokenDetailed[]) {
    await this.cachingService.batchApply
      (tokens,
        token => CacheInfo.TokenTransactions(token.identifier).key,
        async tokens => {
          const result: { [key: string]: number } = {};

          for (const token of tokens) {
            const transactions = await this.transactionService.getTransactionCount({ tokens: [token.identifier, ...token.assets?.extraTokens ?? []] });

            result[token.identifier] = transactions;
          }

          return RecordUtils.mapKeys(result, identifier => CacheInfo.TokenTransactions(identifier).key);
        },
        (token, transactions) => token.transactions = transactions,
        CacheInfo.TokenTransactions('').ttl,
      );

    await this.cachingService.batchApply
      (tokens,
        token => CacheInfo.TokenAccounts(token.identifier).key,
        async tokens => {
          const result: { [key: string]: number } = {};

          for (const token of tokens) {
            let accounts = await this.cachingService.getCacheRemote<number>(CacheInfo.TokenAccountsExtra(token.identifier).key);
            if (!accounts) {
              accounts = await this.getEsdtAccountsCount(token.identifier);
            }

            result[token.identifier] = accounts;
          }

          return RecordUtils.mapKeys(result, identifier => CacheInfo.TokenAccounts(identifier).key);
        },
        (token, accounts) => token.accounts = accounts,
        CacheInfo.TokenAccounts('').ttl,
      );
  }

  async getEsdtAccountsCount(identifier: string): Promise<number> {
    const elasticQuery: ElasticQuery = ElasticQuery.create()
      .withCondition(QueryConditionOptions.must, [QueryType.Match("token", identifier, QueryOperator.AND)]);

    const count = await this.elasticService.getCount("accountsesdt", elasticQuery);

    return count;
  }

  async getEsdtTokenAssetsRaw(identifier: string): Promise<TokenAssets | undefined> {
    return await this.assetsService.getAssets(identifier);
  }

  async getEsdtTokenProperties(identifier: string): Promise<TokenProperties | undefined> {
    const properties = await this.cachingService.getOrSetCache(
      CacheInfo.EsdtProperties(identifier).key,
      async () => await this.getEsdtTokenPropertiesRaw(identifier),
      Constants.oneWeek(),
      CacheInfo.EsdtProperties(identifier).ttl
    );

    if (!properties) {
      return undefined;
    }

    return properties;
  }

  async getEsdtTokenPropertiesRaw(identifier: string): Promise<TokenProperties | null> {
    const arg = Buffer.from(identifier, 'utf8').toString('hex');

    const tokenPropertiesEncoded = await this.vmQueryService.vmQuery(
      this.apiConfigService.getEsdtContractAddress(),
      'getTokenProperties',
      undefined,
      [arg],
      undefined,
      true
    );

    if (!tokenPropertiesEncoded) {
      // this.logger.error(`Could not fetch token properties for token with identifier '${identifier}'`);
      return null;
    }

    const tokenProperties = tokenPropertiesEncoded.map((encoded, index) =>
      Buffer.from(encoded, 'base64').toString(index === 2 ? 'hex' : undefined)
    );

    const [
      name,
      type,
      owner,
      _,
      __,
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

    const tokenProps: TokenProperties = {
      identifier,
      name,
      // @ts-ignore
      type,
      owner: AddressUtils.bech32Encode(owner),
      decimals: parseInt(decimals.split('-').pop() ?? '0'),
      isPaused: TokenHelpers.canBool(isPaused),
      canUpgrade: TokenHelpers.canBool(canUpgrade),
      canMint: TokenHelpers.canBool(canMint),
      canBurn: TokenHelpers.canBool(canBurn),
      canChangeOwner: TokenHelpers.canBool(canChangeOwner),
      canPause: TokenHelpers.canBool(canPause),
      canFreeze: TokenHelpers.canBool(canFreeze),
      canWipe: TokenHelpers.canBool(canWipe),
      canAddSpecialRoles: TokenHelpers.canBool(canAddSpecialRoles),
      canTransferNFTCreateRole: TokenHelpers.canBool(canTransferNFTCreateRole),
      NFTCreateStopped: TokenHelpers.canBool(NFTCreateStopped),
      wiped: wiped.split('-').pop() ?? '',
    };

    if (type === 'FungibleESDT') {
      // @ts-ignore
      delete tokenProps.canAddSpecialRoles;
      // @ts-ignore
      delete tokenProps.canTransferNFTCreateRole;
      // @ts-ignore
      delete tokenProps.NFTCreateStopped;
      // @ts-ignore
      delete tokenProps.wiped;
    }

    return tokenProps;
  }

  async getEsdtAddressesRoles(identifier: string): Promise<TokenRoles[] | undefined> {
    const addressesRoles = await this.cachingService.getOrSetCache(
      CacheInfo.EsdtAddressesRoles(identifier).key,
      async () => await this.getEsdtAddressesRolesRaw(identifier),
      Constants.oneWeek(),
      CacheInfo.EsdtAddressesRoles(identifier).ttl
    );

    if (!addressesRoles) {
      return undefined;
    }

    return addressesRoles;
  }

  async getEsdtAddressesRolesRaw(identifier: string): Promise<TokenRoles[] | null> {
    const arg = BinaryUtils.stringToHex(identifier);

    const tokenAddressesAndRolesEncoded = await this.vmQueryService.vmQuery(
      this.apiConfigService.getEsdtContractAddress(),
      'getAllAddressesAndRoles',
      undefined,
      [arg],
      undefined,
      true
    );

    if (!tokenAddressesAndRolesEncoded) {
      return [];
    }

    const tokenAddressesAndRoles: TokenRoles[] = [];
    let currentAddressRoles = new TokenRoles();
    for (const valueEncoded of tokenAddressesAndRolesEncoded) {
      const address = BinaryUtils.tryBase64ToAddress(valueEncoded);
      if (address) {
        if (currentAddressRoles.address) {
          tokenAddressesAndRoles.push(currentAddressRoles);
        }

        currentAddressRoles = new TokenRoles();
        currentAddressRoles.address = address;

        continue;
      }

      const role = BinaryUtils.base64Decode(valueEncoded);
      TokenHelpers.setTokenRole(currentAddressRoles, role);
    }

    if (currentAddressRoles.address) {
      tokenAddressesAndRoles.push(currentAddressRoles);
    }

    return tokenAddressesAndRoles;
  }

  private async getLockedAccounts(identifier: string): Promise<EsdtLockedAccount[]> {
    return await this.cachingService.getOrSetCache(
      CacheInfo.TokenLockedAccounts(identifier).key,
      async () => await this.getLockedAccountsRaw(identifier),
      CacheInfo.TokenLockedAccounts(identifier).ttl,
    );
  }

  async getLockedAccountsRaw(identifier: string): Promise<EsdtLockedAccount[]> {
    const tokenAssets = await this.assetsService.getAssets(identifier);
    if (!tokenAssets) {
      return [];
    }

    const lockedAccounts = tokenAssets.lockedAccounts;
    if (!lockedAccounts) {
      return [];
    }

    const lockedAccountsWithDescriptions: EsdtLockedAccount[] = [];
    if (Array.isArray(lockedAccounts)) {
      for (const lockedAccount of lockedAccounts) {
        lockedAccountsWithDescriptions.push({
          address: lockedAccount,
          name: undefined,
          balance: '0',
        });
      }
    } else {
      for (const address of Object.keys(lockedAccounts)) {
        lockedAccountsWithDescriptions.push({
          address,
          name: lockedAccounts[address],
          balance: '0',
        });
      }
    }

    if (Object.keys(lockedAccounts).length === 0) {
      return [];
    }

    const addresses = lockedAccountsWithDescriptions.map(x => x.address);

    const esdtLockedAccounts = await this.getAccountEsdtByAddressesAndIdentifier(identifier, addresses);

    for (const esdtLockedAccount of esdtLockedAccounts) {
      const lockedAccountWithDescription = lockedAccountsWithDescriptions.find(x => x.address === esdtLockedAccount.address);
      if (lockedAccountWithDescription) {
        lockedAccountWithDescription.balance = esdtLockedAccount.balance;
      }
    }

    return lockedAccountsWithDescriptions;
  }

  async getTokenSupply(identifier: string): Promise<EsdtSupply> {
    const { supply, minted, burned, initialMinted } = await this.gatewayService.get(`network/esdt/supply/${identifier}`, GatewayComponentRequest.esdtSupply);

    const isCollectionOrToken = identifier.split('-').length === 2;
    if (isCollectionOrToken) {
      let circulatingSupply = BigInt(supply);

      const lockedAccounts = await this.getLockedAccounts(identifier);
      if (lockedAccounts && lockedAccounts.length > 0) {
        const totalLockedSupply = lockedAccounts.sumBigInt(x => BigInt(x.balance));

        circulatingSupply = BigInt(supply) - totalLockedSupply;
      }

      return {
        totalSupply: supply,
        circulatingSupply: circulatingSupply.toString(),
        minted,
        burned,
        initialMinted,
        lockedAccounts,
      };
    }

    return {
      totalSupply: supply,
      circulatingSupply: supply,
      minted,
      burned,
      initialMinted,
      lockedAccounts: undefined,
    };
  }

  async countAllAccounts(identifiers: string[]): Promise<number> {
    const key = `tokens:${identifiers[0]}:distinctAccounts`;

    for (const identifier of identifiers) {
      const query = ElasticQuery.create()
        .withPagination({ from: 0, size: 10000 })
        .withMustMatchCondition('token', identifier, QueryOperator.AND);

      await this.elasticService.getScrollableList('accountsesdt', 'id', query, async items => {
        const distinctAccounts: string[] = items.map(x => x.address).distinct();
        if (distinctAccounts.length > 0) {
          await this.cachingService.setAdd(key, ...distinctAccounts);
        }
      });
    }

    const count = await this.cachingService.setCount(key);

    await this.cachingService.deleteInCache(key);

    return count;
  }

  async getAccountEsdtByAddressesAndIdentifier(identifier: string, addresses: string[]): Promise<any[]> {
    const queries = [];

    for (const address of addresses) {
      queries.push(QueryType.Match('address', address));
    }

    const elasticQuery = ElasticQuery.create()
      .withPagination({ from: 0, size: addresses.length })
      .withCondition(QueryConditionOptions.mustNot, [QueryType.Match("address", "pending-")])
      .withCondition(QueryConditionOptions.must, [QueryType.Match('token', identifier, QueryOperator.AND)])
      .withRangeFilter("balanceNum", new RangeGreaterThanOrEqual(0))
      .withCondition(QueryConditionOptions.should, queries);

    return await this.elasticService.getList('accountsesdt', 'identifier', elasticQuery);
  }

  async getTokenMarketCap(): Promise<number> {
    return await this.cachingService.getOrSetCache(
      CacheInfo.TokenMarketCap.key,
      async () => await this.getTokenMarketCapRaw(),
      CacheInfo.TokenMarketCap.ttl,
    );
  }

  async getTokenMarketCapRaw(): Promise<number> {
    let totalMarketCap = 0;

    const tokens = await this.getAllEsdtAndMetaEsdtTokens();
    for (const token of tokens) {
      if (token.price && token.marketCap) {
        totalMarketCap += token.marketCap;
      }
    }

    return totalMarketCap;
  }


  async getAllMetaESDTTokens(): Promise<TokenDetailed[]> {
    return await this.cachingService.getOrSetCache(
      CacheInfo.AllMetaESDTTokens.key,
      async () => await this.getAllMetaESDTTokensRaw(),
      CacheInfo.AllMetaESDTTokens.ttl
    );
  }

  async getAllMetaESDTTokensRaw(): Promise<TokenDetailed[]> {
    let elasticQuery = ElasticQuery.create();
    elasticQuery = elasticQuery.withMustNotExistCondition('identifier')
      .withMustMultiShouldCondition([NftType.MetaESDT], type => QueryType.Match('type', type))
      .withPagination(new QueryPagination({ from: 0, size: 10000 }));

    const tokenCollections = await this.elasticService.getList('tokens', 'identifier', elasticQuery);
    const collectionsIdentifiers = tokenCollections.map((collection) => collection.token);

    const tokensProperties = await this.cachingService.batchProcess(
      collectionsIdentifiers,
      token => CacheInfo.EsdtProperties(token).key,
      async (identifier: string) => await this.getEsdtTokenPropertiesRaw(identifier),
      Constants.oneDay(),
      true
    );

    const tokensAssets = await this.cachingService.batchProcess(
      collectionsIdentifiers,
      token => CacheInfo.EsdtAssets(token).key,
      async (identifier: string) => await this.getEsdtTokenAssetsRaw(identifier),
      Constants.oneDay(),
      true
    );

    let tokens = tokensProperties.zip(tokensAssets, (first, second) => ApiUtils.mergeObjects(new TokenDetailed, { ...first, assets: second }));

    await this.batchProcessTokens(tokens);

    await this.applyMexPrices(tokens);

    tokens = tokens.sortedDescending(token => token.assets ? 1 : 0, token => token.marketCap ?? 0, token => token.transactions ?? 0);

    return tokens;
  }
}
