import { Inject, Injectable, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { Cron } from "@nestjs/schedule";
import { MetricsService } from "src/common/metrics/metrics.service";
import { ApiConfigService } from "src/common/api-config/api.config.service";
import { CachingService } from "src/common/caching/caching.service";
import { AddressUtils } from "src/utils/address.utils";
import { PerformanceProfiler } from "src/utils/performance.profiler";
import { EventsGateway } from "src/websockets/events.gateway";
import { NodeService } from "src/endpoints/nodes/node.service";
import { ShardTransaction, TransactionProcessor } from "@elrondnetwork/transaction-processor";
import { TransactionUtils } from "src/utils/transaction.utils";
import { CacheInfo } from "src/common/caching/entities/cache.info";
import { BinaryUtils } from "src/utils/binary.utils";
import { TransactionStatus } from "src/endpoints/transactions/entities/transaction.status";
import { TransactionService } from "src/endpoints/transactions/transaction.service";
import { NftService } from "src/endpoints/nfts/nft.service";
import { NftWorkerService } from "src/queue.worker/nft.worker/nft.worker.service";
import { ProcessNftSettings } from "src/endpoints/process-nfts/entities/process.nft.settings";

@Injectable()
export class TransactionProcessorService {
  isProcessing: boolean = false;
  private readonly logger: Logger;
  private transactionProcessor: TransactionProcessor = new TransactionProcessor();

  constructor(
    private readonly cachingService: CachingService,
    private readonly eventsGateway: EventsGateway,
    private readonly apiConfigService: ApiConfigService,
    private readonly metricsService: MetricsService,
    @Inject('PUBSUB_SERVICE') private clientProxy: ClientProxy,
    private readonly nodeService: NodeService,
    private readonly nftWorkerService: NftWorkerService,
    private readonly transactionService: TransactionService,
    private readonly nftService: NftService,
    // private readonly nftExtendedAttributesService: NftExtendedAttributesService,
  ) {
    this.logger = new Logger(TransactionProcessorService.name);
  }

  @Cron('*/1 * * * * *')
  async handleNewTransactions() {
    let isCronActive = this.apiConfigService.getIsTransactionProcessorCronActive();
    if (!isCronActive) {
      return;
    }

    if (this.isProcessing) {
      return;
    }

    try {
      await this.transactionProcessor.start({
        gatewayUrl: this.apiConfigService.getGatewayUrl(),
        maxLookBehind: this.apiConfigService.getTransactionProcessorMaxLookBehind(),
        onTransactionsReceived: async (shard, nonce, transactions) => {
          let profiler = new PerformanceProfiler('Processing new transactions');

          this.logger.log(`New transactions: ${transactions.length} for shard ${shard} and nonce ${nonce}`);

          let allInvalidatedKeys = [];

          for (let transaction of transactions) {
            // this.logger.log(`Transferred ${transaction.value} from ${transaction.sender} to ${transaction.receiver}`);

            if (!AddressUtils.isSmartContractAddress(transaction.sender)) {
              this.eventsGateway.onAccountBalanceChanged(transaction.sender);
            }

            if (!AddressUtils.isSmartContractAddress(transaction.receiver)) {
              this.eventsGateway.onAccountBalanceChanged(transaction.receiver);
            }

            if (transaction.data) {
              const metadataResult = TransactionUtils.tryExtractNftMetadataFromNftCreateTransaction(transaction);
              if (metadataResult) {
                this.logger.log(`Detected NFT Create for collection with identifier '${metadataResult.collection}'. Raw attributes: '${metadataResult.attributes}'`);

                // this.nftExtendedAttributesService.tryGetExtendedAttributesFromBase64EncodedAttributes(BinaryUtils.base64Encode(metadataResult.attributes));
              }
            }

            this.tryHandleNftCreate(transaction);

            let invalidatedTokenProperties = await this.cachingService.tryInvalidateTokenProperties(transaction);
            let invalidatedTokensOnAccountKeys = await this.cachingService.tryInvalidateTokensOnAccount(transaction);
            let invalidatedTokenBalancesKeys = await this.cachingService.tryInvalidateTokenBalance(transaction);
            let invalidatedOwnerKeys = await this.tryInvalidateOwner(transaction);
            let invalidatedCollectionPropertiesKeys = await this.tryInvalidateCollectionProperties(transaction);

            allInvalidatedKeys.push(
              ...invalidatedTokenProperties,
              ...invalidatedTokensOnAccountKeys,
              ...invalidatedTokenBalancesKeys,
              ...invalidatedOwnerKeys,
              ...invalidatedCollectionPropertiesKeys
            );
          }

          let uniqueInvalidatedKeys = allInvalidatedKeys.distinct();
          if (uniqueInvalidatedKeys.length > 0) {
            this.clientProxy.emit('deleteCacheKeys', uniqueInvalidatedKeys);
          }

          let distinctSendersAndReceivers = transactions.selectMany(transaction => [transaction.sender, transaction.receiver]).distinct();
          let txCountInvalidationKeys = distinctSendersAndReceivers.map(address => CacheInfo.TxCount(address).key);
          await this.cachingService.batchDelCache(txCountInvalidationKeys);

          profiler.stop();
        },
        getLastProcessedNonce: async (shardId) => {
          return await this.cachingService.getCache<number>(CacheInfo.ShardNonce(shardId).key);
        },
        setLastProcessedNonce: async (shardId, nonce) => {
          this.metricsService.setLastProcessedNonce(shardId, nonce);
          await this.cachingService.setCache<number>(CacheInfo.ShardNonce(shardId).key, nonce, CacheInfo.ShardNonce(shardId).ttl);
        }
      });
    } finally {
      this.isProcessing = false;
    }
  }

  private async tryHandleNftCreate(transaction: ShardTransaction) {
    if (transaction.receiver !== transaction.sender || !transaction.data || transaction.status !== TransactionStatus.success) {
      return;
    }

    let data = BinaryUtils.base64Decode(transaction.data);
    if (!data.startsWith('ESDTNFTCreate@')) {
      return;
    }

    if (this.apiConfigService.getIsQueueWorkerCronActive()) {
      await new Promise(resolve => setTimeout(resolve, 5000));

      let transactionDetailed = await this.transactionService.getTransaction(transaction.hash);
      if (!transactionDetailed || !transactionDetailed.operations || transactionDetailed.operations.length === 0) {
        return;
      }

      const nftIdentifier = transactionDetailed.operations[0].identifier;

      if (!nftIdentifier) {
        return;
      }

      const nft = await this.nftService.getSingleNft(nftIdentifier);

      await this.nftWorkerService.addProcessNftQueueJob(nft, new ProcessNftSettings());
    }
  }

  async tryInvalidateOwner(transaction: ShardTransaction): Promise<string[]> {
    let transactionFuncName = transaction.getDataFunctionName();
    if (transactionFuncName !== 'mergeValidatorToDelegationWithWhitelist') {
      return [];
    }

    return await this.nodeService.deleteOwnersForAddressInCache(transaction.sender);
  }

  async tryInvalidateCollectionProperties(transaction: ShardTransaction): Promise<string[]> {
    if (!transaction.data) {
      return [];
    }

    const collectionIdentifier = TransactionUtils.tryExtractCollectionIdentifierFromChangeSftToMetaEsdTransaction(transaction);
    if (!collectionIdentifier) {
      return [];
    }

    this.logger.log(`Change SFT to Meta ESDT transaction detected for collection '${collectionIdentifier}'`);

    const key = `esdt:${collectionIdentifier}`;
    await this.cachingService.deleteInCache(key);

    return [key];
  }
}