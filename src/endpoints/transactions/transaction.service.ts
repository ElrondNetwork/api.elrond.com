import { Injectable, Logger } from '@nestjs/common';
import { ApiConfigService } from 'src/helpers/api.config.service';
import { CachingService } from 'src/helpers/caching.service';
import { DataApiService } from 'src/helpers/data.api.service';
import { DataQuoteType } from 'src/helpers/entities/data.quote.type';
import { AbstractQuery } from 'src/helpers/entities/elastic/abstract.query';
import { ElasticPagination } from 'src/helpers/entities/elastic/elastic.pagination';
import { ElasticQuery } from 'src/helpers/entities/elastic/elastic.query';
import { ElasticSortOrder } from 'src/helpers/entities/elastic/elastic.sort.order';
import { ElasticSortProperty } from 'src/helpers/entities/elastic/elastic.sort.property';
import { QueryConditionOptions } from 'src/helpers/entities/elastic/query.condition.options';
import { QueryType } from 'src/helpers/entities/elastic/query.type';
import { GatewayService } from 'src/helpers/gateway.service';
import { base64Encode, bech32Decode, computeShard, mergeObjects, oneDay, oneMinute } from 'src/helpers/helpers';
import { ElasticService } from '../../helpers/elastic.service';
import { SmartContractResult } from './entities/smart.contract.result';
import { Transaction } from './entities/transaction';
import { TransactionCreate } from './entities/transaction.create';
import { TransactionDetailed } from './entities/transaction.detailed';
import { TransactionFilter } from './entities/transaction.filter';
import { TransactionLog } from './entities/transaction.log';
import { TransactionReceipt } from './entities/transaction.receipt';
import { TransactionSendResult } from './entities/transaction.send.result';

@Injectable()
export class TransactionService {
  private readonly logger: Logger

  constructor(
    private readonly elasticService: ElasticService,
    private readonly cachingService: CachingService, 
    private readonly gatewayService: GatewayService,
    private readonly apiConfigService: ApiConfigService,
    private readonly dataApiService: DataApiService,
  ) {
    this.logger = new Logger(TransactionService.name);
  }

  private buildTransactionFilterQuery(filter: TransactionFilter): AbstractQuery[] {

    const queries: AbstractQuery[] = [];

    if (filter.sender) {
      queries.push(QueryType.Match('sender', filter.sender));
    }

    if (filter.receiver) {
      queries.push(QueryType.Match('receiver', filter.receiver));
    }

    if (filter.senderShard) {
      queries.push(QueryType.Match('senderShard', filter.senderShard));
    }

    if (filter.receiverShard) {
      queries.push(QueryType.Match('receiverShard', filter.receiverShard));
    }

    if (filter.miniBlockHash) {
      queries.push(QueryType.Match('miniBlockHash', filter.miniBlockHash));
    }

    if (filter.status) {
      queries.push(QueryType.Match('status', filter.status));
    }

    return queries;
  }

  async getTransactionCount(filter: TransactionFilter): Promise<number> {
    const elasticQueryAdapter: ElasticQuery = new ElasticQuery();
    elasticQueryAdapter.condition[filter.condition ?? QueryConditionOptions.must] = this.buildTransactionFilterQuery(filter);
    
    if (filter.before || filter.after) {
      elasticQueryAdapter.filter = [
        QueryType.Range('timestamp', { before: filter.before, after: filter.after }),
      ]
    }

    return await this.elasticService.getCount('transactions', elasticQueryAdapter);
  }

  async getTransactions(filter: TransactionFilter): Promise<Transaction[]> {
    const elasticQueryAdapter: ElasticQuery = new ElasticQuery();

    const { from, size } = filter;
    const pagination: ElasticPagination = { 
      from, size 
    };
    elasticQueryAdapter.pagination = pagination;
    elasticQueryAdapter.condition[filter.condition ?? QueryConditionOptions.must] = this.buildTransactionFilterQuery(filter);

    const timestamp: ElasticSortProperty = { name: 'timestamp', order: ElasticSortOrder.descending };
    const nonce: ElasticSortProperty = { name: 'nonce', order: ElasticSortOrder.descending };
    elasticQueryAdapter.sort = [timestamp, nonce];

    if (filter.before || filter.after) {
      elasticQueryAdapter.filter = [
        QueryType.Range('timestamp', { before: filter.before, after: filter.after }),
      ]
    }
    
    let transactions = await this.elasticService.getList('transactions', 'txHash', elasticQueryAdapter);

    return transactions.map(transaction => mergeObjects(new Transaction(), transaction));
  }

  async getTransaction(txHash: string): Promise<TransactionDetailed | null> {
    let transaction = await this.tryGetTransactionFromElastic(txHash);

    if (transaction === null) {
      transaction = await this.tryGetTransactionFromGateway(txHash);
    }

    if (transaction !== null) {
      transaction.price = await this.getTransactionPrice(transaction);
    }
    
    return transaction;
  }

  private async getTransactionPrice(transaction: TransactionDetailed): Promise<number | undefined> {
    let dataUrl = this.apiConfigService.getDataUrl();
    if (!dataUrl) {
      return undefined;
    }

    if (transaction === null) {
      return undefined;
    }

    let transactionDate = transaction.getDate();
    if (!transactionDate) {
      return undefined;
    }

    let price = await this.getTransactionPriceForDate(transactionDate);
    if (price) {
      price = price.toRounded(2);
    }

    return price;
  }

  private async getTransactionPriceForDate(date: Date): Promise<number | undefined> {
    if (date.isToday()) {
      return await this.getTransactionPriceToday();
    }

    return await this.getTransactionPriceHistorical(date);
  }

  private async getTransactionPriceToday(): Promise<number | undefined> {
    return await this.cachingService.getOrSetCache(
      'currentPrice',
      async () => await this.dataApiService.getQuotesHistoricalLatest(DataQuoteType.price),
      oneMinute()
    );
  }

  private async getTransactionPriceHistorical(date: Date): Promise<number | undefined> {
    return await this.cachingService.getOrSetCache(
      `price:${date.toISODateString()}`,
      async () => await this.dataApiService.getQuotesHistoricalTimestamp(DataQuoteType.price, date.getTime() / 1000),
      oneDay() * 7
    );
  }

  async tryGetTransactionFromElastic(txHash: string): Promise<TransactionDetailed | null> {
    try {
      const result = await this.elasticService.getItem('transactions', 'txHash', txHash);

      let transactionDetailed: TransactionDetailed = mergeObjects(new TransactionDetailed(), result);

      const hashes: string[] = [];
      hashes.push(txHash);

      if (!this.apiConfigService.getUseLegacyElastic()) {
        const elasticQueryAdapterSc: ElasticQuery = new ElasticQuery();
        elasticQueryAdapterSc.pagination = { from: 0, size: 100 };

        const timestamp: ElasticSortProperty = { name: 'timestamp', order: ElasticSortOrder.ascending };
        elasticQueryAdapterSc.sort = [timestamp];

        const originalTxHashQuery = QueryType.Match('originalTxHash', txHash);
        elasticQueryAdapterSc.condition.must = [originalTxHashQuery];

        if (result.hasScResults === true) {
          let scResults = await this.elasticService.getList('scresults', 'scHash', elasticQueryAdapterSc);
          for (let scResult of scResults) {
            scResult.hash = scResult.scHash;
            hashes.push(scResult.hash);

            delete scResult.scHash;
          }

          transactionDetailed.scResults = scResults.map(scResult => mergeObjects(new SmartContractResult(), scResult));
        }

        const elasticQueryAdapterReceipts: ElasticQuery = new ElasticQuery();
        elasticQueryAdapterReceipts.pagination = { from: 0, size: 1 };
        
        const receiptHashQuery = QueryType.Match('receiptHash', txHash);
        elasticQueryAdapterReceipts.condition.must = [receiptHashQuery];

        let receipts = await this.elasticService.getList('receipts', 'receiptHash', elasticQueryAdapterReceipts);
        if (receipts.length > 0) {
          let receipt = receipts[0];
          transactionDetailed.receipt = mergeObjects(new TransactionReceipt(), receipt);
        }

        const elasticQueryAdapterLogs: ElasticQuery = new ElasticQuery();
        elasticQueryAdapterLogs.pagination = { from: 0, size: 100 };
  
        let queries = [];
        for (let hash of hashes) {
          queries.push(QueryType.Match('_id', hash));
        }
        elasticQueryAdapterLogs.condition.should = queries;
  
        let logs: any[] = await this.elasticService.getLogsForTransactionHashes(elasticQueryAdapterLogs);
  
        for (let log of logs) {
          if (log._id === txHash) {
            transactionDetailed.logs = mergeObjects(new TransactionLog(), log._source);
          }
          else {
            const foundScResult = transactionDetailed.scResults.find(({ hash }) => log._id === hash);
            if (foundScResult) {
              foundScResult.logs = mergeObjects(new TransactionLog(), log._source);
            }
          }
        }
      }

      return mergeObjects(new TransactionDetailed(), transactionDetailed);
    } catch (error) {
      this.logger.error(error);
      return null;
    }
  }

  async tryGetTransactionFromGateway(txHash: string): Promise<TransactionDetailed | null> {
    try {
      const { transaction } = await this.gatewayService.get(`transaction/${txHash}?withResults=true`);

      if (transaction.receipt) {
        transaction.receipt.value = transaction.receipt.value.toString();
      }

      if (transaction.smartContractResults) {
        for (let smartContractResult of transaction.smartContractResults) {
          smartContractResult.callType = smartContractResult.callType.toString();
          smartContractResult.value = smartContractResult.value.toString();

          if (smartContractResult.data) {
            smartContractResult.data = base64Encode(smartContractResult.data);
          }
        }
      }
      
      let result = {
        txHash: txHash,
        data: transaction.data,
        gasLimit: transaction.gasLimit,
        gasPrice: transaction.gasPrice,
        gasUsed: transaction.gasUsed,
        miniBlockHash: transaction.miniblockHash,
        senderShard: transaction.sourceShard,
        receiverShard: transaction.destinationShard,
        nonce: transaction.nonce,
        receiver: transaction.receiver,
        sender: transaction.sender,
        signature: transaction.signature,
        status: transaction.status,
        value: transaction.value,
        round: transaction.round,
        fee: transaction.fee,
        timestamp: transaction.timestamp,
        scResults: transaction.smartContractResults ? transaction.smartContractResults.map((scResult: any) => mergeObjects(new SmartContractResult(), scResult)) : [],
        receipt: transaction.receipt ? mergeObjects(new TransactionReceipt(), transaction.receipt) : undefined,
        logs: transaction.logs
      };

      return mergeObjects(new TransactionDetailed(), result);
    } catch (error) {
      this.logger.error(error);
      return null;
    }
  }

  async createTransaction(transaction: TransactionCreate): Promise<TransactionSendResult> {
    const receiverShard = computeShard(bech32Decode(transaction.receiver));
    const senderShard = computeShard(bech32Decode(transaction.sender));

    const { txHash } = await this.gatewayService.create('transaction/send', transaction);

    // TODO: pending alignment
    return {
      txHash,
      receiver: transaction.receiver,
      sender: transaction.sender,
      receiverShard,
      senderShard,
      status: 'Pending',
    };
  }
}
