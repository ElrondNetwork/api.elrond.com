import { Injectable } from "@nestjs/common";
import { ElasticPagination } from "src/helpers/entities/elastic.pagination";
import { ElasticService } from "src/helpers/elastic.service";
import { mergeObjects } from "src/helpers/helpers";
import { Block } from "./entities/block";
import { BlockDetailed } from "./entities/block.detailed";

@Injectable()
export class BlockService {
  constructor(private readonly elasticService: ElasticService) {}

  async getBlocksCount(): Promise<number> {
    return this.elasticService.getCount('blocks');
  }

  async getBlocks(shard: number | undefined, from: number, size: number): Promise<Block[]> {
    const query = {
      shardId: shard
    };

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

    return result.map(item => mergeObjects(new Block(), item));
  }

  async getBlock(hash: string): Promise<BlockDetailed> {
    let result = await this.elasticService.getItem('blocks', 'hash', hash);

    let publicKeys = await this.elasticService.getPublicKeys(result.shardId, result.epoch);
    result.shard = result.shardId;
    result.proposer = publicKeys[result.proposer];
    result.validators = result.validators.map((validator: number) => publicKeys[validator]);

    return mergeObjects(new BlockDetailed(), result);
  }
}