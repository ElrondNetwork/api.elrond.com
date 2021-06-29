import { forwardRef, Inject, Injectable } from "@nestjs/common";
import { MetricsService } from "src/endpoints/metrics/metrics.service";
import { NftType } from "src/endpoints/tokens/entities/nft.type";
import { ApiConfigService } from "./api.config.service";
import { ApiService } from "./api.service";
import { ElasticPagination } from "./entities/elastic.pagination";
import { PerformanceProfiler } from "./performance.profiler";

@Injectable()
export class ElasticService {
  private readonly url: string;
  private readonly betaUrl: string;

  constructor(
    apiConfigService: ApiConfigService,
    @Inject(forwardRef(() => MetricsService))
    private readonly metricsService: MetricsService,
    private readonly apiService: ApiService
  ) {
    this.url = apiConfigService.getElasticUrl();
    this.betaUrl = apiConfigService.getElasticBetaUrl();
  }

  async getCount(collection: string, query = {}) {
    const url = `${this.url}/${collection}/_count`;
    query = this.buildQuery(query, 'should');
 
    const result: any = await this.post(url, { query });
    let count = result.data.count;

    return count;
  };

  async getItem(collection: string, key: string, identifier: string) {
    const url = `${this.url}/${collection}/_doc/${identifier}`;
    const { data: document } = await this.get(url);

    return this.formatItem(document, key);
  };

  private formatItem(document: any, key: string) {
    const { _id, _source } = document;
    const item: any = {};
    item[key] = _id;
  
    return { ...item, ..._source };
  };

  async getList(collection: string, key: string, query: any, pagination: ElasticPagination, sort: { [key: string]: string }, condition: string = 'must'): Promise<any[]> {
    const url = `${this.url}/${collection}/_search`;
    let elasticSort = this.buildSort(sort);
    let elasticQuery = this.buildQuery(query, condition);

    const {
      data: {
        hits: { hits: documents },
      },
    } = await this.post(url, { query: elasticQuery, sort: elasticSort, from: pagination.from, size: pagination.size });
  
    return documents.map((document: any) => this.formatItem(document, key));
  };

  publicKeysCache: any = {};

  public async getPublicKeys(shard: number, epoch: number) {
    const key = `${shard}_${epoch}`;
  
    if (this.publicKeysCache[key]) {
      return this.publicKeysCache[key];
    }
  
    const url = `${this.url}/validators/_doc/${key}`;
  
    const {
      data: {
        _source: { publicKeys },
      },
    } = await this.get(url);
  
    this.publicKeysCache[key] = publicKeys;
  
    return publicKeys;
  };

  async getBlsIndex(bls: string, shardId: number, epoch: number): Promise<number | boolean> {
    const url = `${this.url}/validators/_doc/${shardId}_${epoch}`;
  
    const {
      data: {
        _source: { publicKeys },
      },
    } = await this.get(url);
  
    const index = publicKeys.indexOf(bls);
  
    if (index !== -1) {
      return index;
    }
  
    return false;
  };

  async getBlses(shard: number, epoch: number) {
    const key = `${shard}_${epoch}`;
  
    const url = `${this.url}/validators/_doc/${key}`;
  
    const {
      data: {
        _source: { publicKeys },
      },
    } = await this.get(url);
  
    return publicKeys;
  };

  private getNestedQuery(path: string, match: any) {
    return {
      nested: {
         path,
         query: {
            bool: {
               must: [
                  {
                     match
                  }
               ]
            }
         }
      }
   };
  }

  private getSimpleQuery(match: any) {
    return {
       bool: {
          must:[
             {
                match
             }
          ]
       }
    };
  }

  private getWildcardQuery(wildcard: any) {
    return { wildcard };
  }

  private getExistsQuery(field: string) {
    return { 
      exists: {
        field
      }
    };
  }

  async getAccountEsdtByIdentifier(identifier: string) {
    let query = this.getSimpleQuery({
        identifier: {
          query: identifier,
          operator: "AND"
      }
    });

    let payload = {
      query: {
         bool: {
            must: [
              query
            ]
         }
      }
    };

    let url = `${this.betaUrl}/accountsesdt/_search`;
    let documents = await this.getDocuments(url, payload);

    return documents.map((document: any) => this.formatItem(document, 'identifier'));
  }

  async getTokensByIdentifiers(identifiers: string[]) {
    let queries = identifiers.map(identifier => this.getSimpleQuery({
        identifier: {
          query: identifier,
          operator: "AND"
      }
    }));

    let payload = {
      query: {
         bool: {
            should: queries
         }
      }
    };

    let url = `${this.betaUrl}/tokens/_search`;
    let documents = await this.getDocuments(url, payload);

    return documents.map((document: any) => this.formatItem(document, 'identifier'));
  }

  async getAccountEsdtByAddress(address: string, from: number, size: number, token: string | undefined) {
    let queries = [];

    queries.push(this.getSimpleQuery({ address }));

    if (token) {
      queries.push(this.getSimpleQuery({
        token: {
          query: token,
          operator: "AND"
        }
      }));
    }

    let payload = {
      from,
      size,
      query: {
         bool: {
            must: queries
         }
      }
    };

    let url = `${this.betaUrl}/accountsesdt/_search`;
    let documents = await this.getDocuments(url, payload);

    return documents.map((document: any) => this.formatItem(document, 'identifier'));
  }

  async getAccountEsdtByAddressCount(address: string) {
    let queries = [];

    queries.push(this.getSimpleQuery({ address }));

    let payload = {
      from: 0,
      size: 0,
      query: {
         bool: {
            must: queries
         }
      }
    };

    let url = `${this.betaUrl}/accountsesdt/_search`;
    return await this.getDocumentCount(url, payload);
  }

  async getTokens(from: number, size: number, search: string | undefined, type: NftType | undefined, identifier: string | undefined, token: string | undefined, tagArray: string[], creator: string | undefined) {
    let queries = [];
    queries.push(this.getExistsQuery('identifier'));

    if (search !== undefined) {
      queries.push(this.getWildcardQuery({ token: `*${search}*` }));
    }

    if (type !== undefined) {
      queries.push(this.getSimpleQuery({ type }));
    }

    if (identifier !== undefined) {
      queries.push(this.getSimpleQuery({ identifier: { query: identifier, operator: "AND" } }));
    }

    if (token !== undefined) {
      queries.push(this.getSimpleQuery({ token: { query: token, operator: "AND" } }));
    }

    if (tagArray.length > 0) {
      for (let tag of tagArray) {
        queries.push(this.getNestedQuery("metaData.attributes", { "metaData.attributes.tags": tag }));
      }
    }

    if (creator !== undefined) {
      queries.push(this.getNestedQuery("metaData", { "metaData.creator": creator }));
    }

    let payload = {
      sort: [
         {
            timestamp: {
               order: "desc"
            }
         }
      ],
      from,
      size,
      query: {
         bool: {
            must: queries
         }
      }
    };

    let url = `${this.betaUrl}/tokens/_search`;
    let documents = await this.getDocuments(url, payload);

    return documents.map((document: any) => this.formatItem(document, 'identifier'));
  }

  async getTokenCount(): Promise<number> {
    let existsQuery = this.getExistsQuery('identifier');

    let payload = {
      from: 0,
      size: 0,
      query: {
         bool: {
            must: [
              existsQuery
            ]
         }
      }
    };

    let url = `${this.betaUrl}/tokens/_search`;
    return await this.getDocumentCount(url, payload);
  }

  private buildQuery(query: any = {}, operator: string = 'must') {
    delete query['from'];
    delete query['size'];

    const before = query['before'];
    const after = query['after'];

    delete query['before'];
    delete query['after'];
    const range: any = this.buildRange({ before, after });

    let result: any = null;

    if (Object.keys(query).length) {
      const must = Object.keys(query)
        .filter(key => query[key] !== null && query[key] !== undefined)
        .map((key) => {
        const match: any = {};

        const value = query[key];
        if (value !== null) {
          match[key] = query[key];
        }

        return { match };
      });

      let criteria: any = {};
      criteria[operator] = must;

      result = { bool: criteria };

      if (Object.keys(range['timestamp']).length != 0) {
        result.bool['filter'] = {
          range
        };
      }
    } 

    if (result === null) {
      result = { match_all: {} };
    }

    return result;
  };

  private buildSort(sort: any): any {
    return Object.keys(sort).map((key) => {
      const obj: any = {};

      obj[key] = {
        order: sort[key]
      };

      return obj;
    });
  };

  private buildRange(range: any = {}) {
    let obj: any = {};
    obj['timestamp'] = {};
    Object.keys(range).map((key) => {
      if (key == 'before' && range[key] != undefined) {
        obj['timestamp']['lte'] = range[key];
      }
      if (key == 'after' && range[key] != undefined) {
        obj['timestamp']['gte'] = range[key];
      }
    });
    return obj;
  };

  private async get(url: string) {
    let profiler = new PerformanceProfiler();
    let result = await this.apiService.get(url);
    profiler.stop();

    this.metricsService.setExternalCall('elastic', profiler.duration);

    return result;
  }

  private async post(url: string, body: any) {
    let profiler = new PerformanceProfiler();
    let result = await this.apiService.post(url, body);
    profiler.stop();

    this.metricsService.setExternalCall('elastic', profiler.duration);

    return result;
  }

  private async getDocuments(url: string, body: any) {
    const {
      data: {
        hits: { hits: documents },
      },
    } = await this.post(url, body);

    return documents;
  }

  private async getDocumentCount(url: string, body: any) {
    const {
      data: {
        hits: {
          total: {
            value
          }
        }
      }
    } = await this.post(url, body);

    return value;
  }
}