import { Injectable } from "@nestjs/common";
import { ElasticPagination } from "src/helpers/entities/elastic.pagination";
import { ElasticService } from "src/helpers/elastic.service";
import { mergeObjects, oneMinute, oneWeek } from "src/helpers/helpers";
import { Block } from "./entities/block";
import { BlockDetailed } from "./entities/block.detailed";
import { CachingService } from "src/helpers/caching.service";
import { BlockFilter } from "./entities/block.filter";
import { QueryPagination } from "src/common/entities/query.pagination";

@Injectable()
export class BlockService {
  constructor(
    private readonly elasticService: ElasticService,
    private readonly cachingService: CachingService
  ) {}

  async getBlocksCount(): Promise<number> {
    return await this.cachingService.getOrSetCache(
      'blocks:count',
      async () => await this.elasticService.getCount('blocks'),
      oneMinute()
    );
  }

  async getBlocks(filter: BlockFilter, queryBase:  QueryPagination): Promise<Block[]> {
    const { from, size } = queryBase || {};
    const { shard, proposer, validator, epoch } = filter || {};

    let query: any = {
      shardId: shard,
      epoch: epoch
    };

    if (proposer && shard !== undefined && epoch !== undefined) {
      let index = await this.elasticService.getBlsIndex(proposer, shard, epoch);
      query.proposer = index ? index : -1;
    }

    if (validator && shard !== undefined && epoch !== undefined) {
      let index = await this.elasticService.getBlsIndex(validator, shard, epoch);
      query.validators = index ? index : -1;
    }

    const pagination: ElasticPagination = {
      from,
      size
    }

    const sort = {
      timestamp: 'desc',
    };

    let result = await this.elasticService.getList('blocks', 'hash', query, pagination, sort);

    for (let item of result) {
      item.shard = item.shardId;
    }

    let finalResult = [];

    for (let item of result) {
      let transformedItem = await this.transformItem(item);

      finalResult.push(transformedItem);
    }

    return finalResult.map(item => mergeObjects(new Block(), item));
  }

  async transformItem(item: any) {
    // eslint-disable-next-line no-unused-vars
    let { shardId: shard, epoch, proposer, validators, searchOrder, ...rest } = item;

    let key = `${shard}_${epoch}`;
    let blses: any = await this.cachingService.getCacheLocal(key);
    if (!blses) {
      blses = await this.elasticService.getBlses(shard, epoch);

      await this.cachingService.setCacheLocal(key, blses, oneWeek());
    }
  
    proposer = blses[proposer];
    validators = validators.map((index: number) => blses[index]);
  
    return { shard, epoch, proposer, validators, ...rest };
  };

  async getBlock(hash: string): Promise<BlockDetailed> {
    let result = await this.elasticService.getItem('blocks', 'hash', hash);

    let publicKeys = await this.elasticService.getPublicKeys(result.shardId, result.epoch);
    result.shard = result.shardId;
    result.proposer = publicKeys[result.proposer];
    result.validators = result.validators.map((validator: number) => publicKeys[validator]);

    return mergeObjects(new BlockDetailed(), result);
  }
}