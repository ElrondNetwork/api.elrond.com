import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { ApiConfigService } from "src/common/api-config/api.config.service";
import { QueryPagination } from "src/common/entities/query.pagination";
import { TokenHelpers } from "src/utils/token.helpers";
import { Nft } from "./entities/nft";
import { NftAccount } from "./entities/nft.account";
import { NftFilter } from "./entities/nft.filter";
import { NftOwner } from "./entities/nft.owner";
import { NftType } from "./entities/nft.type";
import { NftQueryOptions } from "./entities/nft.query.options";
import { EsdtService } from "../esdt/esdt.service";
import { AssetsService } from "../../common/assets/assets.service";
import { PluginService } from "src/common/plugins/plugin.service";
import { NftMetadataService } from "src/queue.worker/nft.worker/queue/job-services/metadata/nft.metadata.service";
import { NftMediaService } from "src/queue.worker/nft.worker/queue/job-services/media/nft.media.service";
import { NftMedia } from "./entities/nft.media";
import { CacheInfo } from "src/utils/cache.info";
import { EsdtSupply } from "../esdt/entities/esdt.supply";
import { EsdtDataSource } from "../esdt/entities/esdt.data.source";
import { EsdtAddressService } from "../esdt/esdt.address.service";
import { PersistenceService } from "src/common/persistence/persistence.service";
import { MexTokenService } from "../mex/mex.token.service";
import { ApiUtils, BinaryUtils, Constants, NumberUtils, RecordUtils, CachingService, ElasticService, ElasticQuery, QueryConditionOptions, QueryType, QueryOperator, ElasticSortOrder, RangeGreaterThanOrEqual, RangeLowerThan, BatchUtils, TokenUtils } from "@elrondnetwork/erdnest";
import { LockedAssetService } from "../../common/locked-asset/locked-asset.service";

@Injectable()
export class NftService {
  private readonly logger: Logger;
  private readonly NFT_THUMBNAIL_PREFIX: string;
  readonly DEFAULT_MEDIA: NftMedia[];

  constructor(
    private readonly apiConfigService: ApiConfigService,
    private readonly elasticService: ElasticService,
    private readonly esdtService: EsdtService,
    private readonly assetsService: AssetsService,
    private readonly cachingService: CachingService,
    @Inject(forwardRef(() => PluginService))
    private readonly pluginService: PluginService,
    private readonly nftMetadataService: NftMetadataService,
    private readonly nftMediaService: NftMediaService,
    private readonly persistenceService: PersistenceService,
    @Inject(forwardRef(() => EsdtAddressService))
    private readonly esdtAddressService: EsdtAddressService,
    private readonly mexTokenService: MexTokenService,
    private readonly lockedAssetService: LockedAssetService,
  ) {
    this.logger = new Logger(NftService.name);
    this.NFT_THUMBNAIL_PREFIX = this.apiConfigService.getExternalMediaUrl() + '/nfts/asset';
    this.DEFAULT_MEDIA = [
      {
        url: 'https://media.elrond.com/nfts/thumbnail/default.png',
        originalUrl: 'https://media.elrond.com/nfts/thumbnail/default.png',
        thumbnailUrl: 'https://media.elrond.com/nfts/thumbnail/default.png',
        fileType: 'image/png',
        fileSize: 29512,
      },
    ];
  }

  buildElasticNftFilter(filter: NftFilter, identifier?: string, address?: string) {
    let elasticQuery = ElasticQuery.create()
      .withCondition(QueryConditionOptions.must, QueryType.Exists('identifier'))
      .withMustNotCondition(QueryType.Match('type', NftType.MetaESDT));

    if (address) {
      elasticQuery = elasticQuery.withMustCondition(QueryType.Match('address', address));
    }

    if (filter.search !== undefined) {
      elasticQuery = elasticQuery.withSearchWildcardCondition(filter.search, ['token', 'name']);
    }

    if (filter.type !== undefined) {
      elasticQuery = elasticQuery.withMustCondition(QueryType.Match('type', filter.type));
    }

    if (identifier !== undefined) {
      elasticQuery = elasticQuery.withMustCondition(QueryType.Match('identifier', identifier, QueryOperator.AND));
    }

    if (filter.collection !== undefined && filter.collection !== '') {
      elasticQuery = elasticQuery.withMustCondition(QueryType.Match('token', filter.collection, QueryOperator.AND));
    }

    if (filter.collections !== undefined && filter.collections.length !== 0) {
      elasticQuery = elasticQuery.withMustCondition(QueryType.Should(filter.collections.map(collection => QueryType.Match('token', collection, QueryOperator.AND))));
    }

    if (filter.name !== undefined && filter.name !== '') {
      elasticQuery = elasticQuery.withMustCondition(QueryType.Nested('data', { "data.name": filter.name }));
    }

    if (filter.hasUris !== undefined) {
      elasticQuery = elasticQuery.withMustCondition(QueryType.Nested('data', { "data.nonEmptyURIs": filter.hasUris }));
    }

    if (filter.tags) {
      elasticQuery = elasticQuery.withMustCondition(QueryType.Should(filter.tags.map(tag => QueryType.Nested("data", { "data.tags": tag }))));
    }

    if (filter.creator !== undefined) {
      elasticQuery = elasticQuery.withMustCondition(QueryType.Nested("data", { "data.creator": filter.creator }));
    }

    if (filter.identifiers) {
      elasticQuery = elasticQuery.withMustCondition(QueryType.Should(filter.identifiers.map(identifier => QueryType.Match('identifier', identifier, QueryOperator.AND))));
    }

    if (filter.isWhitelistedStorage !== undefined && this.apiConfigService.getIsIndexerV3FlagActive()) {
      elasticQuery = elasticQuery.withMustCondition(QueryType.Nested("data", { "data.whiteListedStorage": filter.isWhitelistedStorage }));
    }

    if (filter.isNsfw !== undefined) {
      const nsfwThreshold = this.apiConfigService.getNftExtendedAttributesNsfwThreshold();

      if (filter.isNsfw === true) {
        elasticQuery = elasticQuery.withRangeFilter('nft_nsfw_mark', new RangeGreaterThanOrEqual(nsfwThreshold));
      } else {
        elasticQuery = elasticQuery.withRangeFilter('nft_nsfw_mark', new RangeLowerThan(nsfwThreshold));
      }
    }

    if (filter.before || filter.after) {
      elasticQuery = elasticQuery.withDateRangeFilter('timestamp', filter.before, filter.after);
    }

    return elasticQuery;
  }

  async getNfts(queryPagination: QueryPagination, filter: NftFilter, queryOptions?: NftQueryOptions): Promise<Nft[]> {
    const { from, size } = queryPagination;

    const nfts = await this.getNftsInternal({ from, size }, filter);

    for (const nft of nfts) {
      await this.applyAssetsAndTicker(nft);
    }

    if (queryOptions && queryOptions.withOwner) {
      const nftsIdentifiers = nfts.filter(x => x.type === NftType.NonFungibleESDT).map(x => x.identifier);

      const accountsEsdts = await this.getAccountEsdtByIdentifiers(nftsIdentifiers, { from: 0, size: nftsIdentifiers.length });

      for (const nft of nfts) {
        if (nft.type === NftType.NonFungibleESDT) {
          const accountEsdt = accountsEsdts.find((accountEsdt: any) => accountEsdt.identifier == nft.identifier);
          if (accountEsdt) {
            nft.owner = accountEsdt.address;
          }
        }
      }
    }

    if (queryOptions && queryOptions.withSupply) {
      await this.batchApplySupply(nfts);
    }

    await this.batchProcessNfts(nfts);

    for (const nft of nfts) {
      await this.applyUnlockSchedule(nft);
    }

    return nfts;
  }

  private async batchProcessNfts(nfts: Nft[]) {
    await Promise.all([
      this.batchApplyMedia(nfts),
      this.batchApplyMetadata(nfts),
    ]);

    await this.pluginService.batchProcessNfts(nfts);
  }

  private async applyNftOwner(nft: Nft): Promise<void> {
    if (nft.type === NftType.NonFungibleESDT) {
      const accountsEsdt = await this.getAccountEsdtByIdentifier(nft.identifier);
      if (accountsEsdt.length > 0) {
        nft.owner = accountsEsdt[0].address;
      }
    }
  }

  private async batchApplySupply(nfts: Nft[]) {
    await this.cachingService.batchApply(
      nfts,
      nft => CacheInfo.TokenLockedAccounts(nft.identifier).key,
      async nfts => {
        const result: Record<string, EsdtSupply> = {};

        for (const nft of nfts) {
          result[nft.identifier] = await this.esdtService.getTokenSupply(nft.identifier);
        }

        return RecordUtils.mapKeys(result, identifier => CacheInfo.TokenLockedAccounts(identifier).key);
      },
      (nft, value) => nft.supply = value.totalSupply,
      CacheInfo.TokenLockedAccounts('').ttl,
    );
  }

  private async batchApplyMedia(nfts: Nft[]) {
    await this.cachingService.batchApply(
      nfts,
      nft => CacheInfo.NftMedia(nft.identifier).key,
      async nfts => {
        const getMediaResults = await this.persistenceService.batchGetMedia(nfts.map((nft) => nft.identifier));

        return RecordUtils.mapKeys(getMediaResults, identifier => CacheInfo.NftMedia(identifier).key);
      },
      (nft, media) => nft.media = media,
      CacheInfo.NftMedia('').ttl,
    );

    for (const nft of nfts) {
      if (TokenHelpers.needsDefaultMedia(nft)) {
        nft.media = this.DEFAULT_MEDIA;
      }
    }
  }

  private async batchApplyMetadata(nfts: Nft[]) {
    await this.cachingService.batchApply(
      nfts,
      nft => CacheInfo.NftMetadata(nft.identifier).key,
      async nfts => {
        const getMetadataResults = await this.persistenceService.batchGetMetadata(nfts.map((nft) => nft.identifier));

        return RecordUtils.mapKeys(getMetadataResults, identifier => CacheInfo.NftMetadata(identifier).key);
      },
      (nft, metadata) => nft.metadata = metadata,
      CacheInfo.NftMetadata('').ttl
    );
  }

  private async processNft(nft: Nft) {
    await Promise.all([
      this.applyMedia(nft),
      this.applyMetadata(nft),
      this.pluginService.processNft(nft),
    ]);

    if (TokenHelpers.needsDefaultMedia(nft)) {
      nft.media = this.DEFAULT_MEDIA;
    }
  }

  async applyAssetsAndTicker(token: Nft) {
    token.assets = await this.assetsService.getAssets(token.identifier) ??
      await this.assetsService.getAssets(token.collection);

    if (token.assets) {
      token.ticker = token.collection.split('-')[0];
    } else {
      token.ticker = token.collection;
    }
  }

  async getSingleNft(identifier: string): Promise<Nft | undefined> {
    const nfts = await this.getNftsInternal(new QueryPagination({ from: 0, size: 1 }), new NftFilter(), identifier);

    if (!TokenUtils.isNft(identifier)) {
      return undefined;
    }

    if (nfts.length === 0) {
      return undefined;
    }

    const nft: Nft = ApiUtils.mergeObjects(new Nft(), nfts[0]);

    if (nft.identifier.toLowerCase() !== identifier.toLowerCase()) {
      return undefined;
    }

    await this.applySupply(nft);

    await this.applyNftOwner(nft);

    await this.applyNftAttributes(nft);

    await this.applyAssetsAndTicker(nft);

    await this.applyUnlockSchedule(nft);

    await this.processNft(nft);

    return nft;
  }

  private async applyUnlockSchedule(nft: Nft): Promise<void> {
    nft.unlockSchedule = await this.lockedAssetService.getUnlockSchedule(nft.identifier, nft.attributes);
  }

  private async applyNftAttributes(nft: Nft): Promise<void> {
    if (!nft.owner) {
      return;
    }

    const nftsForAddress = await this.esdtAddressService.getNftsForAddress(nft.owner, new NftFilter({ identifiers: [nft.identifier] }), new QueryPagination({ from: 0, size: 1 }));
    if (nftsForAddress.length === 0) {
      return;
    }

    nft.attributes = nftsForAddress[0].attributes;
  }

  private async applyMedia(nft: Nft) {
    nft.media = await this.nftMediaService.getMedia(nft.identifier) ?? undefined;
  }

  private async applyMetadata(nft: Nft) {
    nft.metadata = await this.nftMetadataService.getMetadata(nft) ?? undefined;
  }

  private async isNft(identifier: string): Promise<boolean> {
    if (identifier.split('-').length !== 3) {
      return false;
    }

    const nfts = await this.getNftsInternal(new QueryPagination({ from: 0, size: 1 }), new NftFilter(), identifier);

    return nfts.length > 0;
  }

  async getNftOwners(identifier: string, pagination: QueryPagination): Promise<NftOwner[] | undefined> {
    const isNft = await this.isNft(identifier);
    if (!isNft) {
      return undefined;
    }

    const accountsEsdt = await this.getAccountEsdtByIdentifier(identifier, pagination);

    return accountsEsdt.map((esdt: any) => {
      const owner = new NftOwner();
      owner.address = esdt.address;
      owner.balance = esdt.balance;

      return owner;
    });
  }

  async getNftsInternal(pagination: QueryPagination, filter: NftFilter, identifier?: string): Promise<Nft[]> {
    const elasticQuery = this.buildElasticNftFilter(filter, identifier);
    elasticQuery
      .withPagination(pagination)
      .withSort([
        { name: 'timestamp', order: ElasticSortOrder.descending },
        { name: 'nonce', order: ElasticSortOrder.descending },
      ]);

    let elasticNfts = await this.elasticService.getList('tokens', 'identifier', elasticQuery);
    if (elasticNfts.length === 0 && identifier !== undefined) {
      elasticNfts = await this.elasticService.getList('accountsesdt', 'identifier', ElasticQuery.create().withMustMatchCondition('identifier', identifier, QueryOperator.AND));
    }

    const nfts: Nft[] = [];

    for (const elasticNft of elasticNfts) {
      const nft = new Nft();
      nft.identifier = elasticNft.identifier;
      nft.collection = elasticNft.token;
      nft.nonce = parseInt('0x' + nft.identifier.split('-')[2]);
      nft.timestamp = elasticNft.timestamp;

      this.applyExtendedAttributes(nft, elasticNft);

      const elasticNftData = elasticNft.data;
      if (elasticNftData) {
        nft.name = elasticNftData.name;
        nft.creator = elasticNftData.creator;
        nft.royalties = elasticNftData.royalties ? elasticNftData.royalties / 100 : undefined; // 10.000 => 100%
        nft.attributes = elasticNftData.attributes;

        if (elasticNftData.uris) {
          nft.uris = elasticNftData.uris;
        }

        if (elasticNftData.tags) {
          nft.tags = elasticNftData.tags;
        }

        if (nft.uris && nft.uris.length > 0) {
          try {
            nft.url = TokenHelpers.computeNftUri(BinaryUtils.base64Decode(nft.uris[0]), this.NFT_THUMBNAIL_PREFIX);
          } catch (error) {
            this.logger.error(error);
          }
        }

        if (this.apiConfigService.getIsIndexerV3FlagActive()) {
          nft.isWhitelistedStorage = elasticNft.data.whiteListedStorage;
        } else {
          nft.isWhitelistedStorage = nft.url.startsWith(this.NFT_THUMBNAIL_PREFIX);
        }
      }

      nfts.push(nft);
    }

    for (const nft of nfts) {
      const collectionProperties = await this.esdtService.getEsdtTokenProperties(nft.collection);

      if (collectionProperties) {
        if (!nft.name) {
          nft.name = collectionProperties.name;
        }

        // @ts-ignore
        nft.type = collectionProperties.type;

        if (nft.type === NftType.MetaESDT) {
          nft.decimals = collectionProperties.decimals;
          // @ts-ignore
          delete nft.royalties;
          // @ts-ignore
          delete nft.uris;
        }
      }
    }

    return nfts;
  }

  public isWhitelistedStorage(uris: string[] | undefined): boolean {
    if (!uris || uris.length === 0) {
      return false;
    }

    let url = '';
    try {
      url = TokenHelpers.computeNftUri(BinaryUtils.base64Decode(uris[0]), this.NFT_THUMBNAIL_PREFIX);
    } catch (error) {
      this.logger.error(`Error when computing uri from '${uris[0]}'`);
      this.logger.error(error);
      return false;
    }

    return url.startsWith(this.NFT_THUMBNAIL_PREFIX);
  }

  async getNftOwnersCount(identifier: string): Promise<number | undefined> {
    const owners = await this.cachingService.getOrSetCache(
      `nftOwnerCount:${identifier}`,
      async () => await this.getNftOwnersCountRaw(identifier),
      Constants.oneMinute()
    );

    if (owners === null) {
      return undefined;
    }

    return owners;
  }

  async getNftOwnersCountRaw(identifier: string): Promise<number | null> {
    const isNft = await this.isNft(identifier);
    if (!isNft) {
      return null;
    }

    const elasticQuery = ElasticQuery.create()
      .withCondition(QueryConditionOptions.mustNot, [QueryType.Match('address', 'pending')])
      .withCondition(QueryConditionOptions.must, [QueryType.Match('identifier', identifier, QueryOperator.AND)]);

    return await this.elasticService.getCount('accountsesdt', elasticQuery);
  }

  async getNftCount(filter: NftFilter): Promise<number> {
    const elasticQuery = this.buildElasticNftFilter(filter);

    return await this.elasticService.getCount('tokens', elasticQuery);
  }

  async getNftsForAddress(address: string, queryPagination: QueryPagination, filter: NftFilter, queryOptions?: NftQueryOptions, source?: EsdtDataSource): Promise<NftAccount[]> {
    const nfts = await this.esdtAddressService.getNftsForAddress(address, filter, queryPagination, source);

    for (const nft of nfts) {
      await this.applyAssetsAndTicker(nft);
      await this.applyPriceUsd(nft);
    }

    if (queryOptions && queryOptions.withSupply) {
      await this.batchApplySupply(nfts);
    }

    await this.batchProcessNfts(nfts);

    if (this.apiConfigService.isNftExtendedAttributesEnabled()) {
      const internalNfts = await this.getNftsInternalByIdentifiers(nfts.map(x => x.identifier));

      const indexedInternalNfts = internalNfts.toRecord<Nft>(x => x.identifier);
      for (const nft of nfts) {
        const indexedNft = indexedInternalNfts[nft.identifier];
        if (indexedNft) {
          nft.score = indexedNft.score;
          nft.rank = indexedNft.rank;
          nft.isNsfw = indexedNft.isNsfw;
        }
      }
    }

    for (const nft of nfts) {
      await this.applyUnlockSchedule(nft);
    }

    return nfts;
  }

  private async getNftsInternalByIdentifiers(identifiers: string[]): Promise<Nft[]> {
    const chunks = BatchUtils.splitArrayIntoChunks(identifiers, 1024);
    const result: Nft[] = [];
    for (const identifiers of chunks) {
      const internalNfts = await this.getNftsInternal(new QueryPagination({ from: 0, size: identifiers.length }), new NftFilter({ identifiers }));

      result.push(...internalNfts);
    }

    return result;
  }

  private async applyPriceUsd(nft: NftAccount) {
    if (nft.type !== NftType.MetaESDT) {
      return;
    }

    try {
      const prices = await this.mexTokenService.getMexPrices();

      const price = prices[nft.collection];
      if (price) {
        nft.price = price.price;
        nft.valueUsd = price.price * NumberUtils.denominateString(nft.balance, nft.decimals);
      }
    } catch (error) {
      this.logger.error(`Unable to apply price on MetaESDT with identifier '${nft.identifier}'`);
      this.logger.error(error);
    }
  }

  async getNftCountForAddress(address: string, filter: NftFilter): Promise<number> {
    return await this.esdtAddressService.getNftCountForAddressFromElastic(address, filter);
  }

  async getNftForAddress(address: string, identifier: string): Promise<NftAccount | undefined> {
    const filter = new NftFilter();
    filter.identifiers = [identifier];

    if (!TokenUtils.isNft(identifier)) {
      return undefined;
    }

    const nfts = await this.getNftsForAddress(address, new QueryPagination({ from: 0, size: 1 }), filter);
    if (nfts.length === 0) {
      return undefined;
    }

    const nft = nfts[0];

    await this.applyUnlockSchedule(nft);

    return nft;
  }

  async applySupply(nft: Nft): Promise<void> {
    const { totalSupply } = await this.esdtService.getTokenSupply(nft.identifier);

    nft.supply = totalSupply;
  }

  async getNftSupply(identifier: string): Promise<string | undefined> {
    if (identifier.split('-').length !== 3) {
      return undefined;
    }

    const nfts = await this.getNftsInternal(new QueryPagination({ from: 0, size: 1 }), new NftFilter(), identifier);
    if (nfts.length === 0) {
      return undefined;
    }

    const supply = await this.esdtService.getTokenSupply(identifier);

    return supply.totalSupply;
  }

  async getAccountEsdtByIdentifier(identifier: string, pagination?: QueryPagination) {
    return await this.getAccountEsdtByIdentifiers([identifier], pagination);
  }

  async getAccountEsdtByIdentifiers(identifiers: string[], pagination?: QueryPagination) {
    if (identifiers.length === 0) {
      return [];
    }

    const queries = identifiers.map((identifier) => QueryType.Match('identifier', identifier, QueryOperator.AND));

    let elasticQuery = ElasticQuery.create();

    if (pagination) {
      elasticQuery = elasticQuery.withPagination(pagination);
    }

    elasticQuery = elasticQuery
      .withSort([{ name: "balanceNum", order: ElasticSortOrder.descending }])
      .withCondition(QueryConditionOptions.mustNot, [QueryType.Match('address', 'pending')])
      .withCondition(QueryConditionOptions.should, queries)
      .withSort([{ name: 'timestamp', order: ElasticSortOrder.descending }]);

    return await this.elasticService.getList('accountsesdt', 'identifier', elasticQuery);
  }

  applyExtendedAttributes(nft: Nft, elasticNft: any) {
    nft.score = elasticNft.nft_rarity_score;
    nft.rank = elasticNft.nft_rarity_rank;

    if (elasticNft.nft_nsfw_mark !== undefined) {
      nft.isNsfw = elasticNft.nft_nsfw_mark >= this.apiConfigService.getNftExtendedAttributesNsfwThreshold();
    }
  }
}
