import { Injectable, Logger } from "@nestjs/common";
import { Token } from "./entities/token";
import { TokenWithBalance } from "./entities/token.with.balance";
import { TokenDetailed } from "./entities/token.detailed";
import { QueryPagination } from "src/common/entities/query.pagination";
import { TokenFilter } from "./entities/token.filter";
import { TokenHelpers } from "src/utils/token.helpers";
import { EsdtService } from "../esdt/esdt.service";
import { TokenAccount } from "./entities/token.account";
import { TokenType } from "./entities/token.type";
import { EsdtAddressService } from "../esdt/esdt.address.service";
import { GatewayService } from "src/common/gateway/gateway.service";
import { GatewayComponentRequest } from "src/common/gateway/entities/gateway.component.request";
import { ApiConfigService } from "src/common/api-config/api.config.service";
import { TokenProperties } from "./entities/token.properties";
import { TokenRoles } from "./entities/token.roles";
import { TokenSupplyResult } from "./entities/token.supply.result";
import { TokenDetailedWithBalance } from "./entities/token.detailed.with.balance";
import { SortOrder } from "src/common/entities/sort.order";
import { TokenSort } from "./entities/token.sort";
import { TokenWithRoles } from "./entities/token.with.roles";
import { TokenWithRolesFilter } from "./entities/token.with.roles.filter";
import { AddressUtils, ApiUtils, ElasticQuery, ElasticService, ElasticSortOrder, NumberUtils, QueryConditionOptions, QueryOperator, QueryType, TokenUtils } from "@elrondnetwork/erdnest";
import { NftService } from "../nfts/nft.service";
import { NftFilter } from "../nfts/entities/nft.filter";
import { NftAccount } from "../nfts/entities/nft.account";
import { NftType } from "../nfts/entities/nft.type";

@Injectable()
export class TokenService {
  private readonly logger: Logger;
  constructor(
    private readonly esdtService: EsdtService,
    private readonly elasticService: ElasticService,
    private readonly esdtAddressService: EsdtAddressService,
    private readonly gatewayService: GatewayService,
    private readonly apiConfigService: ApiConfigService,
    private readonly nftService: NftService,
  ) {
    this.logger = new Logger(TokenService.name);
  }

  async isToken(identifier: string): Promise<boolean> {
    const tokens = await this.esdtService.getAllEsdtAndMetaEsdtTokens();
    return tokens.find(x => x.identifier === identifier) !== undefined;
  }

  async getToken(identifier: string): Promise<TokenDetailed | undefined> {
    const tokens = await this.esdtService.getAllEsdtAndMetaEsdtTokens();
    let token = tokens.find(x => x.identifier === identifier);

    if (!TokenUtils.isToken(identifier)) {
      return undefined;
    }

    if (!token) {
      return undefined;
    }

    token = ApiUtils.mergeObjects(new TokenDetailed(), token);

    await this.applyTickerFromAssets(token);

    await this.applySupply(token);

    token.roles = await this.getTokenRoles(identifier);

    return token;
  }

  async getTokens(queryPagination: QueryPagination, filter: TokenFilter): Promise<TokenDetailed[]> {
    const { from, size } = queryPagination;

    let tokens = await this.getFilteredTokens(filter);

    tokens = tokens.slice(from, from + size);

    for (const token of tokens) {
      this.applyTickerFromAssets(token);
    }

    return tokens.map(item => ApiUtils.mergeObjects(new TokenDetailed(), item));
  }

  applyTickerFromAssets(token: Token) {
    if (token.assets) {
      token.ticker = token.identifier.split('-')[0];
    } else {
      token.ticker = token.identifier;
    }
  }

  async getFilteredTokens(filter: TokenFilter): Promise<TokenDetailed[]> {
    let tokens = await this.esdtService.getAllEsdtAndMetaEsdtTokens();
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();

      tokens = tokens.filter(token => token.name.toLowerCase().includes(searchLower) || token.identifier.toLowerCase().includes(searchLower));
    }

    if (filter.name) {
      const nameLower = filter.name.toLowerCase();

      tokens = tokens.filter(token => token.name.toLowerCase() === nameLower);
    }

    if (filter.identifier) {
      const identifierLower = filter.identifier.toLowerCase();

      tokens = tokens.filter(token => token.identifier.toLowerCase().includes(identifierLower));
    }

    if (filter.identifiers) {
      const identifierArray = filter.identifiers.map(identifier => identifier.toLowerCase());

      tokens = tokens.filter(token => identifierArray.includes(token.identifier.toLowerCase()));
    }

    if (filter.sort) {
      tokens = this.sortTokens(tokens, filter.sort, filter.order ?? SortOrder.desc);
    }

    return tokens;
  }

  private sortTokens(tokens: TokenDetailed[], sort: TokenSort, order: SortOrder): TokenDetailed[] {
    let criteria: (token: Token) => number;

    switch (sort) {
      case TokenSort.accounts:
        criteria = token => token.accounts ?? 0;
        break;
      case TokenSort.transactions:
        criteria = token => token.transactions ?? 0;
        break;
      case TokenSort.price:
        criteria = token => token.price ?? 0;
        break;
      case TokenSort.marketCap:
        criteria = token => token.marketCap ?? 0;
        break;
      default:
        throw new Error(`Unsupported sorting criteria '${sort}'`);
    }

    switch (order) {
      case SortOrder.asc:
        tokens = tokens.sorted(criteria);
        break;
      case SortOrder.desc:
        tokens = tokens.sortedDescending(criteria);
        break;
    }

    return tokens;
  }

  async getTokenCount(filter: TokenFilter): Promise<number> {
    const tokens = await this.getFilteredTokens(filter);

    return tokens.length;
  }

  async getTokenCountForAddress(address: string): Promise<number> {
    if (AddressUtils.isSmartContractAddress(address)) {
      return await this.getTokenCountForAddressFromElastic(address);
    }

    return await this.getTokenCountForAddressFromGateway(address);
  }

  async getTokenCountForAddressFromElastic(address: string): Promise<number> {
    const query = ElasticQuery.create()
      .withMustNotCondition(QueryType.Exists('identifier'))
      .withMustCondition(QueryType.Match('address', address));

    return await this.elasticService.getCount('accountsesdt', query);
  }

  async getTokenCountForAddressFromGateway(address: string): Promise<number> {
    const tokens = await this.getAllTokensForAddress(address, new TokenFilter());
    return tokens.length;
  }

  async getTokensForAddress(address: string, queryPagination: QueryPagination, filter: TokenFilter): Promise<TokenWithBalance[]> {
    if (AddressUtils.isSmartContractAddress(address)) {
      return await this.getTokensForAddressFromElastic(address, queryPagination, filter);
    }

    return await this.getTokensForAddressFromGateway(address, queryPagination, filter);
  }

  async getTokensForAddressFromElastic(address: string, queryPagination: QueryPagination, filter: TokenFilter): Promise<TokenWithBalance[]> {
    let query = ElasticQuery.create()
      .withCondition(QueryConditionOptions.must, QueryType.Exists('identifier'))
      .withMustCondition(QueryType.Match('address', address))
      .withPagination({ from: queryPagination.from, size: queryPagination.size });

    if (filter.identifier) {
      query = query.withMustCondition(QueryType.Match('token', filter.identifier));
    }

    if (filter.identifiers) {
      query = query.withShouldCondition(filter.identifiers.map(identifier => QueryType.Match('token', identifier)));
    }

    if (filter.name) {
      query = query.withMustCondition(QueryType.Nested('data.name', filter.name));
    }

    if (filter.search) {
      query = query.withMustCondition(QueryType.Nested('data.name', filter.search));
    }

    const elasticTokens = await this.elasticService.getList('accountsesdt', 'token', query);

    const allTokens = await this.esdtService.getAllEsdtAndMetaEsdtTokens();

    const result: TokenWithBalance[] = [];
    for (const token of allTokens) {
      this.addTokensWithBalance(elasticTokens, token, result);
    }

    return result;
  }

  private addTokensWithBalance(elasticTokens: any[], token: TokenDetailed, result: TokenWithBalance[]) {
    for (const elasticToken of elasticTokens) {
      if (elasticToken.token === token.identifier) {
        const tokenWithBalance: TokenWithBalance = {
          ...token,
          balance: elasticToken.balance,
          valueUsd: undefined,
        };
        tokenWithBalance.identifier = elasticToken.identifier;
        this.applyValueUsd(tokenWithBalance);
        result.push(tokenWithBalance);
      }
    }
  }

  applyValueUsd(tokenWithBalance: TokenWithBalance) {
    if (tokenWithBalance.price) {
      tokenWithBalance.valueUsd = tokenWithBalance.price * NumberUtils.denominateString(tokenWithBalance.balance, tokenWithBalance.decimals);
    }
  }

  async getTokensForAddressFromGateway(address: string, queryPagination: QueryPagination, filter: TokenFilter): Promise<TokenWithBalance[]> {
    let tokens = await this.getAllTokensForAddress(address, filter);

    tokens = tokens.slice(queryPagination.from, queryPagination.from + queryPagination.size);
    tokens = tokens.map(token => ApiUtils.mergeObjects(new TokenWithBalance(), token));

    for (const token of tokens) {
      this.applyTickerFromAssets(token);

      this.applyValueUsd(token);
    }

    return tokens;
  }

  async getTokenForAddress(address: string, identifier: string): Promise<TokenDetailedWithBalance | undefined> {
    const tokens = await this.getFilteredTokens({ identifier });

    if (!TokenUtils.isToken(identifier)) {
      return undefined;
    }

    if (!tokens.length) {
      this.logger.log(`Error when fetching token ${identifier} details for address ${address}`);
      return undefined;
    }

    const token = tokens[0];
    // eslint-disable-next-line require-await
    const esdt = await this.gatewayService.get(`address/${address}/esdt/${identifier}`, GatewayComponentRequest.addressEsdtBalance, async (error) => {
      const errorMessage = error?.response?.data?.error;
      if (errorMessage && errorMessage.includes('account was not found')) {
        return true;
      }

      return false;
    });

    if (!esdt || !esdt.tokenData || esdt.tokenData.balance === '0') {
      return undefined;
    }

    const balance = esdt.tokenData.balance;
    let tokenWithBalance: TokenDetailedWithBalance = {
      ...token,
      balance,
      valueUsd: undefined,
    };
    tokenWithBalance = ApiUtils.mergeObjects(new TokenDetailedWithBalance(), tokenWithBalance);

    this.applyValueUsd(tokenWithBalance);

    tokenWithBalance.identifier = token.identifier;

    await this.applyTickerFromAssets(tokenWithBalance);

    await this.applySupply(tokenWithBalance);

    return tokenWithBalance;
  }

  async getAllTokensForAddress(address: string, filter: TokenFilter): Promise<TokenWithBalance[]> {
    const tokens = await this.getFilteredTokens(filter);

    const tokensIndexed: { [index: string]: Token } = {};
    for (const token of tokens) {
      tokensIndexed[token.identifier] = token;
    }

    const esdts = await this.esdtAddressService.getAllEsdtsForAddressFromGateway(address);
    const metaESDTNfts = await this.nftService.getNftsForAddress(
      address,
      new QueryPagination(
        { from: 0, size: 10000 }
      ),
      new NftFilter({
        identifiers: filter.identifiers ?? (filter.identifier ? [filter.identifier] : []),
        search: filter.search,
        name: filter.name,
        type: NftType.MetaESDT,
      })
    );
    const metaESDTNftsIndexed: { [index: string]: NftAccount } = {};
    for (const metaESDTNft of metaESDTNfts) {
      metaESDTNftsIndexed[metaESDTNft.identifier] = metaESDTNft;
    }

    const tokensWithBalance: TokenWithBalance[] = [];

    for (const tokenIdentifier of Object.keys(esdts)) {
      if (
        !(TokenUtils.isNft(tokenIdentifier) || TokenUtils.isToken(tokenIdentifier)) &&
        !Object.keys(metaESDTNftsIndexed).includes(tokenIdentifier)
      ) {
        continue;
      }

      const esdt = esdts[tokenIdentifier];
      const token = tokensIndexed[tokenIdentifier];
      const metaESDTNft = metaESDTNftsIndexed[tokenIdentifier];
      if (!token && !metaESDTNft) {
        continue;
      }

      const tokenWithBalance = {
        ...token,
        ...esdt,
        ...this.tokenFromNftAccount(metaESDTNft),
      };

      tokensWithBalance.push(tokenWithBalance);
    }

    for (const token of tokensWithBalance) {
      // @ts-ignore
      token.identifier = token.tokenIdentifier;
      // @ts-ignore
      delete token.tokenIdentifier;
    }

    return tokensWithBalance;
  }

  private tokenFromNftAccount(nftAccount: NftAccount): Token | undefined {
    if (!nftAccount) {
      return undefined;
    }
    return new Token({
      identifier: nftAccount.identifier,
      name: nftAccount.name,
      ticker: nftAccount.ticker,
      owner: nftAccount.owner,
      decimals: nftAccount.decimals,
      assets: nftAccount.assets,
      price: nftAccount.price,
      supply: nftAccount.supply,
    });
  }

  async getTokenAccounts(pagination: QueryPagination, identifier: string): Promise<TokenAccount[] | undefined> {
    const properties = await this.getTokenProperties(identifier);
    if (!properties) {
      return undefined;
    }

    const elasticQuery: ElasticQuery = ElasticQuery.create()
      .withPagination(pagination)
      .withSort([{ name: "balanceNum", order: ElasticSortOrder.descending }])
      .withCondition(QueryConditionOptions.must, [QueryType.Match("token", identifier, QueryOperator.AND)])
      .withCondition(QueryConditionOptions.mustNot, [QueryType.Match('address', 'pending')]);

    const tokenAccounts = await this.elasticService.getList("accountsesdt", identifier, elasticQuery);

    return tokenAccounts.map((tokenAccount) => ApiUtils.mergeObjects(new TokenAccount(), tokenAccount));
  }

  async getTokenAccountsCount(identifier: string): Promise<number | undefined> {
    const properties = await this.getTokenProperties(identifier);
    if (!properties) {
      return undefined;
    }

    const elasticQuery: ElasticQuery = ElasticQuery.create()
      .withCondition(QueryConditionOptions.must, [QueryType.Match("token", identifier, QueryOperator.AND)]);

    const count = await this.elasticService.getCount("accountsesdt", elasticQuery);

    return count;
  }

  private async getTokenRolesFromElastic(identifier: string): Promise<TokenRoles[] | undefined> {
    const token = await this.elasticService.getItem('tokens', 'identifier', identifier);
    if (!token) {
      return undefined;
    }

    if (!token.roles) {
      return undefined;
    }

    const roles: TokenRoles[] = [];
    for (const role of Object.keys(token.roles)) {
      const addresses = token.roles[role].distinct();

      for (const address of addresses) {
        let addressRole = roles.find((addressRole) => addressRole.address === address);
        if (!addressRole) {
          addressRole = new TokenRoles();
          addressRole.address = address;
          roles.push(addressRole);
        }

        TokenHelpers.setTokenRole(addressRole, role);
      }
    }

    return roles;
  }

  async getTokenRoles(identifier: string): Promise<TokenRoles[] | undefined> {
    if (this.apiConfigService.getIsIndexerV3FlagActive()) {
      return await this.getTokenRolesFromElastic(identifier);
    }

    return await this.esdtService.getEsdtAddressesRoles(identifier);
  }

  async getTokenRolesForIdentifierAndAddress(identifier: string, address: string): Promise<TokenRoles | undefined> {
    if (this.apiConfigService.getIsIndexerV3FlagActive()) {
      const token = await this.elasticService.getItem('tokens', 'identifier', identifier);

      if (!token) {
        return undefined;
      }

      if (!token.roles) {
        return undefined;
      }

      const addressRoles: TokenRoles = new TokenRoles();
      addressRoles.address = address;
      for (const role of Object.keys(token.roles)) {
        const addresses = token.roles[role].distinct();
        if (addresses.includes(address)) {
          TokenHelpers.setTokenRole(addressRoles, role);
        }
      }

      //@ts-ignore
      delete addressRoles.address;

      return addressRoles;
    }

    const tokenAddressesRoles = await this.esdtService.getEsdtAddressesRoles(identifier);
    let addressRoles = tokenAddressesRoles?.find((role: TokenRoles) => role.address === address);
    if (addressRoles) {
      // clone
      addressRoles = new TokenRoles(JSON.parse(JSON.stringify(addressRoles)));

      //@ts-ignore
      delete addressRoles?.address;
    }

    return addressRoles;
  }

  async applySupply(token: TokenDetailed): Promise<void> {
    const supply = await this.esdtService.getTokenSupply(token.identifier);

    token.supply = NumberUtils.denominate(BigInt(supply.totalSupply), token.decimals).toFixed();
    token.circulatingSupply = NumberUtils.denominate(BigInt(supply.circulatingSupply), token.decimals).toFixed();

    if (supply.minted) {
      token.minted = supply.minted;
    }

    if (supply.burned) {
      token.burnt = supply.burned;
    }

    if (supply.initialMinted) {
      token.initialMinted = supply.initialMinted;
    }
  }

  async getTokenSupply(identifier: string, denominated: boolean | undefined = undefined): Promise<TokenSupplyResult | undefined> {
    const properties = await this.getTokenProperties(identifier);
    if (!properties) {
      return undefined;
    }

    const result = await this.esdtService.getTokenSupply(identifier);

    const totalSupply = NumberUtils.denominateString(result.totalSupply, properties.decimals);
    const circulatingSupply = NumberUtils.denominateString(result.circulatingSupply, properties.decimals);

    let lockedAccounts = result.lockedAccounts;
    if (lockedAccounts !== undefined) {
      lockedAccounts = JSON.parse(JSON.stringify(lockedAccounts));
      if (denominated === true) {
        // @ts-ignore
        for (const lockedAccount of lockedAccounts) {
          lockedAccount.balance = NumberUtils.denominateString(lockedAccount.balance.toString(), properties.decimals);
        }
      }
    }

    return {
      supply: denominated === true ? totalSupply : totalSupply.toFixed(),
      circulatingSupply: denominated === true ? circulatingSupply : circulatingSupply.toFixed(),
      minted: denominated === true && result.minted ? NumberUtils.denominateString(result.minted, properties.decimals) : result.minted,
      burnt: denominated === true && result.burned ? NumberUtils.denominateString(result.burned, properties.decimals) : result.burned,
      initialMinted: denominated === true && result.initialMinted ? NumberUtils.denominateString(result.initialMinted, properties.decimals) : result.initialMinted,
      lockedAccounts,
    };
  }

  async getTokenProperties(identifier: string): Promise<TokenProperties | undefined> {
    if (identifier.split('-').length !== 2) {
      return undefined;
    }

    const properties = await this.esdtService.getEsdtTokenProperties(identifier);
    if (!properties) {
      return undefined;
    }

    if (properties.type !== TokenType.FungibleESDT) {
      return undefined;
    }

    return properties;
  }

  async getTokensWithRolesForAddressCount(address: string, filter: TokenWithRolesFilter): Promise<number> {
    const elasticQuery = this.buildTokensWithRolesForAddressQuery(address, filter);

    return await this.elasticService.getCount('tokens', elasticQuery);
  }

  async getTokenWithRolesForAddress(address: string, identifier: string): Promise<TokenWithRoles | undefined> {
    const tokens = await this.getTokensWithRolesForAddress(address, { identifier }, { from: 0, size: 1 });
    if (tokens.length === 0) {
      return undefined;
    }

    return tokens[0];
  }

  async getTokensWithRolesForAddress(address: string, filter: TokenWithRolesFilter, pagination: QueryPagination): Promise<TokenWithRoles[]> {
    const elasticQuery = this.buildTokensWithRolesForAddressQuery(address, filter, pagination);

    const tokenList = await this.elasticService.getList('tokens', 'identifier', elasticQuery);

    const allTokens = await this.esdtService.getAllEsdtAndMetaEsdtTokens();

    const result: TokenWithRoles[] = [];

    for (const item of tokenList) {
      const token = allTokens.find(x => x.identifier === item.identifier);
      if (token) {
        const resultItem = ApiUtils.mergeObjects(new TokenWithRoles(), token);
        if (item.roles) {
          if (item.roles.ESDTRoleLocalMint && item.roles.ESDTRoleLocalMint.includes(address)) {
            resultItem.canLocalMint = true;
          }

          if (item.roles.ESDTRoleLocalBurn && item.roles.ESDTRoleLocalBurn.includes(address)) {
            resultItem.canLocalBurn = true;
          }
        }

        result.push(resultItem);
      }
    }

    return result;
  }

  private buildTokensWithRolesForAddressQuery(address: string, filter: TokenWithRolesFilter, pagination?: QueryPagination): ElasticQuery {
    let elasticQuery = ElasticQuery.create()
      .withMustNotExistCondition('identifier')
      .withMustCondition(QueryType.Should(
        [
          QueryType.Match('currentOwner', address),
          QueryType.Nested('roles', { 'roles.ESDTRoleLocalMint': address }),
          QueryType.Nested('roles', { 'roles.ESDTRoleLocalBurn': address }),
        ]
      ))
      .withMustMatchCondition('type', TokenType.FungibleESDT)
      .withMustMatchCondition('token', filter.identifier)
      .withMustMatchCondition('currentOwner', filter.owner);

    if (filter.search) {
      elasticQuery = elasticQuery
        .withShouldCondition([
          QueryType.Wildcard('token', filter.search),
          QueryType.Wildcard('name', filter.search),
        ]);
    }

    if (filter.canMint !== undefined) {
      const condition = filter.canMint === true ? QueryConditionOptions.must : QueryConditionOptions.mustNot;
      elasticQuery = elasticQuery.withCondition(condition, QueryType.Nested('roles', { 'roles.ESDTRoleLocalMint': address }));
    }

    if (filter.canBurn !== undefined) {
      const condition = filter.canBurn === true ? QueryConditionOptions.must : QueryConditionOptions.mustNot;
      elasticQuery = elasticQuery.withCondition(condition, QueryType.Nested('roles', { 'roles.ESDTRoleLocalBurn': address }));
    }

    if (pagination) {
      elasticQuery = elasticQuery.withPagination(pagination);
    }

    return elasticQuery;
  }
}
