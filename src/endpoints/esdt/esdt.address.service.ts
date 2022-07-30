import { BadRequestException, forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { ApiConfigService } from "src/common/api-config/api.config.service";
import { QueryPagination } from "src/common/entities/query.pagination";
import { GatewayComponentRequest } from "src/common/gateway/entities/gateway.component.request";
import { GatewayService } from "src/common/gateway/gateway.service";
import { ProtocolService } from "src/common/protocol/protocol.service";
import { TokenHelpers } from "src/utils/token.helpers";
import { EsdtDataSource } from "./entities/esdt.data.source";
import { EsdtService } from "./esdt.service";
import { GatewayNft } from "../nfts/entities/gateway.nft";
import { NftAccount } from "../nfts/entities/nft.account";
import { NftFilter } from "../nfts/entities/nft.filter";
import { NftType } from "../nfts/entities/nft.type";
import { NftExtendedAttributesService } from "../nfts/nft.extendedattributes.service";
import { NftService } from "../nfts/nft.service";
import { NftCollectionRole } from "../collections/entities/nft.collection.role";
import { CollectionService } from "../collections/collection.service";
import { NftCollection } from "../collections/entities/nft.collection";
import { CollectionFilter } from "../collections/entities/collection.filter";
import { CollectionRoles } from "../tokens/entities/collection.roles";
import { AddressUtils, ApiUtils, BinaryUtils, CachingService, ElasticService, ElasticSortOrder, MetricsService } from "@elrondnetwork/erdnest";

@Injectable()
export class EsdtAddressService {
  private readonly logger: Logger;
  private readonly NFT_THUMBNAIL_PREFIX: string;

  constructor(
    private readonly apiConfigService: ApiConfigService,
    private readonly esdtService: EsdtService,
    private readonly elasticService: ElasticService,
    private readonly gatewayService: GatewayService,
    private readonly cachingService: CachingService,
    private readonly metricsService: MetricsService,
    private readonly protocolService: ProtocolService,
    private readonly nftExtendedAttributesService: NftExtendedAttributesService,
    @Inject(forwardRef(() => NftService))
    private readonly nftService: NftService,
    @Inject(forwardRef(() => CollectionService))
    private readonly collectionService: CollectionService,
  ) {
    this.logger = new Logger(EsdtAddressService.name);
    this.NFT_THUMBNAIL_PREFIX = this.apiConfigService.getExternalMediaUrl() + '/nfts/asset';
  }

  async getNftsForAddress(address: string, filter: NftFilter, pagination: QueryPagination, source?: EsdtDataSource): Promise<NftAccount[]> {
    if (filter.identifiers && filter.identifiers.length === 1) {
      return await this.getNftsForAddressFromGateway(address, filter, pagination);
    }

    if (source === EsdtDataSource.elastic || AddressUtils.isSmartContractAddress(address)) {
      return await this.getNftsForAddressFromElastic(address, filter, pagination);
    }

    return await this.getNftsForAddressFromGateway(address, filter, pagination);
  }

  async getNftCountForAddressFromElastic(address: string, filter: NftFilter): Promise<number> {
    const elasticQuery = this.nftService.buildElasticNftFilter(filter, undefined, address);
    return await this.elasticService.getCount('accountsesdt', elasticQuery);
  }

  async getCollectionCountForAddressFromElastic(address: string, filter: CollectionFilter): Promise<number> {
    const elasticQuery = this.collectionService.buildCollectionRolesFilter(filter, address);

    return await this.elasticService.getCount('tokens', elasticQuery);
  }

  private async getNftsForAddressFromElastic(address: string, filter: NftFilter, pagination: QueryPagination): Promise<NftAccount[]> {
    let elasticQuery = this.nftService.buildElasticNftFilter(filter, undefined, address)
      .withPagination(pagination);

    if (this.apiConfigService.getIsIndexerV3FlagActive()) {
      elasticQuery = elasticQuery.withSort([
        { name: 'timestamp', order: ElasticSortOrder.descending },
        { name: 'tokenNonce', order: ElasticSortOrder.descending },
      ]);
    } else {
      elasticQuery = elasticQuery.withSort([{ name: '_id', order: ElasticSortOrder.ascending }]);
    }

    const esdts = await this.elasticService.getList('accountsesdt', 'identifier', elasticQuery);

    const gatewayNfts: GatewayNft[] = [];

    for (const esdt of esdts) {
      const isToken = esdt.tokenNonce === undefined;
      const nft = new GatewayNft();
      if (isToken) {
        nft.balance = esdt.balance;
        nft.tokenIdentifier = esdt.token;
      } else {
        nft.attributes = esdt.data?.attributes;
        nft.balance = esdt.balance;
        nft.creator = esdt.data?.creator;
        nft.name = esdt.data?.name;
        nft.nonce = esdt.tokenNonce;
        nft.royalties = esdt.data?.royalties;
        nft.tokenIdentifier = esdt.identifier;
        nft.uris = esdt.data?.uris;
        nft.timestamp = esdt.timestamp;
      }

      gatewayNfts.push(nft);
    }

    const nfts: GatewayNft[] = Object.values(gatewayNfts).map(x => x as any).filter(x => x.tokenIdentifier.split('-').length === 3);

    const nftAccounts: NftAccount[] = await this.mapToNftAccount(nfts);

    return nftAccounts;
  }

  async getCollectionsForAddress(address: string, filter: CollectionFilter, pagination: QueryPagination): Promise<NftCollectionRole[]> {
    if (!this.apiConfigService.getIsIndexerV3FlagActive() && (filter.canCreate !== undefined || filter.canBurn !== undefined || filter.canAddQuantity !== undefined || filter.canUpdateAttributes !== undefined || filter.canAddUri !== undefined || filter.canTransferRole !== undefined)) {
      throw new BadRequestException('canCreate / canBurn / canAddQuantity / canUpdateAttributes / canAddUri / canTransferRole filter not supported when fetching account collections from elastic');
    }

    const elasticQuery = this.collectionService.buildCollectionRolesFilter(filter, address)
      .withSort([{ name: 'timestamp', order: ElasticSortOrder.descending }])
      .withPagination(pagination);

    const tokenCollections = await this.elasticService.getList('tokens', 'identifier', elasticQuery);
    const collectionsIdentifiers = tokenCollections.map((collection) => collection.token);

    const indexedCollections: Record<string, any> = {};
    for (const collection of tokenCollections) {
      indexedCollections[collection.token] = collection;
    }

    const accountCollections = await this.collectionService.applyPropertiesToCollections(collectionsIdentifiers);

    for (const accountCollection of accountCollections) {
      const indexedCollection = indexedCollections[accountCollection.collection];
      if (indexedCollection) {
        accountCollection.timestamp = indexedCollection.timestamp;

        if (indexedCollection.roles) {
          const addressRoles: CollectionRoles = new CollectionRoles();
          addressRoles.address = address;

          for (const role of Object.keys(indexedCollection.roles)) {
            const addresses = indexedCollection.roles[role].distinct();
            if (addresses.includes(address)) {
              TokenHelpers.setCollectionRole(addressRoles, role);
            }
          }

          accountCollection.roles = [addressRoles];
        }
      }
    }

    if (this.apiConfigService.getIsIndexerV3FlagActive()) {
      const nftAccountCollections: NftCollectionRole[] = [];
      for (const collection of accountCollections) {
        const role = collection.roles.find(x => x.address === address) ?? new CollectionRoles();

        if (collection.type === NftType.NonFungibleESDT) {
          //@ts-ignore
          delete role.canAddQuantity;
        }

        const accountCollection = ApiUtils.mergeObjects(new NftCollectionRole(), { ...collection, ...role });

        if (accountCollection.timestamp === 0) {
          // @ts-ignore
          delete accountCollection.timestamp;
        }

        // @ts-ignore
        delete accountCollection.roles;

        nftAccountCollections.push(accountCollection);
      }

      return nftAccountCollections;
    }

    const accountCollectionsWithRoles: NftCollectionRole[] = await this.applyRolesToAccountCollections(address, accountCollections);

    return accountCollectionsWithRoles;
  }

  private async applyRolesToAccountCollections(address: string, collections: NftCollection[]): Promise<NftCollectionRole[]> {
    const rolesResult = await this.gatewayService.get(`address/${address}/esdts/roles`, GatewayComponentRequest.addressEsdtAllRoles);
    const roles = rolesResult.roles;

    const nftCollections: NftCollectionRole[] = [];
    for (const collection of collections) {
      const accountCollection: NftCollectionRole = ApiUtils.mergeObjects(new NftCollectionRole(), collection);

      const role = roles[collection.collection];
      accountCollection.canCreate = role ? role.includes('ESDTRoleNFTCreate') : false;
      accountCollection.canBurn = role ? role.includes('ESDTRoleNFTBurn') : false;
      accountCollection.canUpdateAttributes = role ? role.includes('ESDTRoleNFTUpdateAttributes') : false;
      accountCollection.canAddUri = role ? role.includes('ESDTRoleNFTAddURI') : false;
      accountCollection.canTransferRole = role ? role.includes('ESDTTransferRole') : false;

      if (collection.type === NftType.SemiFungibleESDT) {
        accountCollection.canAddQuantity = role ? role.includes('ESDTRoleNFTAddQuantity') : false;
      }

      if (accountCollection.timestamp === 0) {
        // @ts-ignore
        delete accountCollection.timestamp;
      }

      nftCollections.push(accountCollection);
    }

    return nftCollections;
  }

  private async getNftsForAddressFromGateway(address: string, filter: NftFilter, pagination: QueryPagination): Promise<NftAccount[]> {
    let esdts: Record<string, any> = {};

    if (filter.identifiers && filter.identifiers.length === 1) {
      const identifier = filter.identifiers[0];
      const collection = identifier.split('-').slice(0, 2).join('-');
      const nonceHex = identifier.split('-')[2];
      const nonceNumeric = BinaryUtils.hexToNumber(nonceHex);

      const result = await this.gatewayService.get(`address/${address}/nft/${collection}/nonce/${nonceNumeric}`, GatewayComponentRequest.addressNftByNonce);
      if (!result || !result.tokenData || result.tokenData.balance === '0') {
        return [];
      }

      result.tokenData.tokenIdentifier = identifier;

      esdts[identifier] = result.tokenData;
    } else {
      esdts = await this.getAllEsdtsForAddressFromGateway(address);
    }

    const nfts: GatewayNft[] = Object.values(esdts).map(x => x as any).filter(x => x.tokenIdentifier.split('-').length === 3);

    const collator = new Intl.Collator('en', { sensitivity: 'base' });
    nfts.sort((a: GatewayNft, b: GatewayNft) => collator.compare(a.tokenIdentifier, b.tokenIdentifier));

    let nftAccounts: NftAccount[] = await this.mapToNftAccount(nfts);
    nftAccounts = nftAccounts.filter(x => [NftType.NonFungibleESDT, NftType.SemiFungibleESDT].includes(x.type));
    return this.filterEsdtsForAddressFromGateway(filter, pagination, nftAccounts);
  }

  private async mapToNftAccount(nfts: GatewayNft[]): Promise<NftAccount[]> {
    const nftAccounts: NftAccount[] = [];

    for (const dataSourceNft of nfts) {
      const nft = new NftAccount();
      nft.identifier = dataSourceNft.tokenIdentifier;
      nft.collection = dataSourceNft.tokenIdentifier.split('-').slice(0, 2).join('-');
      nft.nonce = dataSourceNft.nonce;
      nft.creator = dataSourceNft.creator;
      nft.royalties = Number(dataSourceNft.royalties) / 100; // 10.000 => 100%
      nft.uris = dataSourceNft.uris ? dataSourceNft.uris.filter((x: any) => x) : [];
      nft.name = dataSourceNft.name;
      nft.timestamp = dataSourceNft.timestamp;

      if (nft.uris && nft.uris.length > 0) {
        try {
          nft.url = TokenHelpers.computeNftUri(BinaryUtils.base64Decode(nft.uris[0]), this.NFT_THUMBNAIL_PREFIX);
        } catch (error) {
          this.logger.error(error);
        }
      }

      nft.isWhitelistedStorage = nft.url.startsWith(this.NFT_THUMBNAIL_PREFIX);

      nft.attributes = dataSourceNft.attributes;

      if (dataSourceNft.attributes) {
        nft.tags = this.nftExtendedAttributesService.getTags(dataSourceNft.attributes);
      }

      const collectionDetails = await this.esdtService.getEsdtTokenProperties(nft.collection);
      if (collectionDetails) {
        // @ts-ignore
        nft.type = collectionDetails.type;

        if (nft.type === NftType.MetaESDT) {
          nft.decimals = collectionDetails.decimals;
          // @ts-ignore
          delete nft.royalties;
          // @ts-ignore
          delete nft.uris;
        }

        if (!nft.name) {
          nft.name = collectionDetails.name;
        }
      }

      if ([NftType.SemiFungibleESDT, NftType.MetaESDT].includes(nft.type)) {
        nft.balance = dataSourceNft.balance;
      }

      nftAccounts.push(nft);
    }

    return nftAccounts;
  }

  private async getAllEsdtsForAddressFromGatewayRaw(address: string): Promise<{ [key: string]: any }> {
    // eslint-disable-next-line require-await
    const esdtResult = await this.gatewayService.get(`address/${address}/esdt`, GatewayComponentRequest.addressEsdt, async (error) => {
      const errorMessage = error?.response?.data?.error;
      if (errorMessage && errorMessage.includes('account was not found')) {
        return true;
      }

      return false;
    });

    if (!esdtResult) {
      return {};
    }

    return esdtResult.esdts;
  }

  private pendingRequestsDictionary: { [key: string]: any; } = {};

  async getAllEsdtsForAddressFromGateway(address: string): Promise<{ [key: string]: any }> {
    let pendingRequest = this.pendingRequestsDictionary[address];
    if (pendingRequest) {
      const result = await pendingRequest;
      this.metricsService.incrementPendingApiHit('Gateway.AccountEsdts');
      return result;
    }

    const cachedValue = await this.cachingService.getCacheLocal<{ [key: string]: any }>(`address:${address}:esdts`);

    if (cachedValue) {
      this.metricsService.incrementCachedApiHit('Gateway.AccountEsdts');
      return cachedValue;
    }

    pendingRequest = this.getAllEsdtsForAddressFromGatewayRaw(address);
    this.pendingRequestsDictionary[address] = pendingRequest;

    let esdts: { [key: string]: any };
    try {
      esdts = await pendingRequest;
    } finally {
      delete this.pendingRequestsDictionary[address];
    }

    const ttl = await this.protocolService.getSecondsRemainingUntilNextRound();

    await this.cachingService.setCacheLocal(`address:${address}:esdts`, esdts, ttl);

    return esdts;
  }

  private filterEsdtsForAddressFromGateway(filter: NftFilter, pagination: QueryPagination, nfts: NftAccount[]): NftAccount[] {
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();

      nfts = nfts.filter(x => x.name.toLowerCase().includes(searchLower) || x.identifier.toLowerCase().includes(searchLower));
    }

    if (filter.identifiers) {
      nfts = nfts.filter(x => filter.identifiers?.includes(x.identifier));
    }

    if (filter.type) {
      const types = (filter.type ?? '').split(',');

      nfts = nfts.filter(x => types.includes(x.type));
    }

    if (filter.collection) {
      nfts = nfts.filter(x => x.collection === filter.collection);
    }

    if (filter.name) {
      const searchedNameLower = filter.name.toLowerCase();

      nfts = nfts.filter(x => x.name.toLowerCase().includes(searchedNameLower));
    }

    if (filter.collections) {
      const collectionsArray = filter.collections;
      nfts = nfts.filter(x => collectionsArray.includes(x.collection));
    }

    if (filter.tags) {
      const tagsArray = filter.tags;
      nfts = nfts.filter(nft => tagsArray.filter(tag => nft.tags.includes(tag)).length === tagsArray.length);
    }

    if (filter.creator) {
      nfts = nfts.filter(x => x.creator === filter.creator);
    }

    if (filter.hasUris === true) {
      nfts = nfts.filter(x => x.uris && x.uris.length > 0);
    } else if (filter.hasUris === false) {
      nfts = nfts.filter(x => x.uris && x.uris.length === 0);
    }

    if (filter.includeFlagged !== true) {
      nfts = nfts.filter(x => !x.scamInfo);
    }

    const { from, size } = pagination;

    nfts = nfts.slice(from, from + size);

    return nfts;
  }
}
