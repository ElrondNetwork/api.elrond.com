import { BadRequestException, Controller, DefaultValuePipe, Get, HttpException, HttpStatus, Logger, NotFoundException, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AccountService } from './account.service';
import { AccountDetailed } from './entities/account.detailed';
import { Account } from './entities/account';
import { AccountDeferred } from './entities/account.deferred';
import { TokenService } from '../tokens/token.service';
import { TokenWithBalance } from '../tokens/entities/token.with.balance';
import { DelegationLegacyService } from '../delegation.legacy/delegation.legacy.service';
import { AccountDelegationLegacy } from '../delegation.legacy/entities/account.delegation.legacy';
import { AccountKey } from './entities/account.key';
import { NftAccount } from '../nfts/entities/nft.account';
import { NftType } from '../nfts/entities/nft.type';
import { WaitingList } from '../waiting-list/entities/waiting.list';
import { WaitingListService } from '../waiting-list/waiting.list.service';
import { StakeService } from '../stake/stake.service';
import { NftService } from '../nfts/nft.service';
import { TransactionStatus } from '../transactions/entities/transaction.status';
import { TransactionService } from '../transactions/transaction.service';
import { DeployedContract } from './entities/deployed.contract';
import { SmartContractResult } from '../sc-results/entities/smart.contract.result';
import { SmartContractResultService } from '../sc-results/scresult.service';
import { CollectionService } from '../collections/collection.service';
import { NftCollectionRole } from '../collections/entities/nft.collection.role';
import { SortOrder } from 'src/common/entities/sort.order';
import { AccountHistory } from "./entities/account.history";
import { AccountEsdtHistory } from "./entities/account.esdt.history";
import { EsdtDataSource } from '../esdt/entities/esdt.data.source';
import { TransferService } from '../transfers/transfer.service';
import { ApiConfigService } from 'src/common/api-config/api.config.service';
import { Transaction } from '../transactions/entities/transaction';
import { ProviderStake } from '../stake/entities/provider.stake';
import { TokenDetailedWithBalance } from '../tokens/entities/token.detailed.with.balance';
import { NftCollectionAccount } from '../collections/entities/nft.collection.account';
import { TokenWithRoles } from '../tokens/entities/token.with.roles';
import { ParseAddressPipe, ParseArrayPipe, ParseBlockHashPipe, ParseCollectionPipe, ParseNftPipe, ParseOptionalBoolPipe, ParseOptionalEnumArrayPipe, ParseOptionalEnumPipe, ParseOptionalIntPipe, ParseTokenOrNftPipe, ParseTransactionHashPipe } from '@elrondnetwork/erdnest';
import { QueryPagination } from 'src/common/entities/query.pagination';
import { TransactionQueryOptions } from '../transactions/entities/transactions.query.options';
import { TokenWithRolesFilter } from '../tokens/entities/token.with.roles.filter';
import { CollectionFilter } from '../collections/entities/collection.filter';
import { TokenFilter } from '../tokens/entities/token.filter';
import { NftFilter } from '../nfts/entities/nft.filter';
import { NftQueryOptions } from '../nfts/entities/nft.query.options';
import { TransactionFilter } from '../transactions/entities/transaction.filter';
import { ParseTokenPipe } from '@elrondnetwork/erdnest';

@Controller()
@ApiTags('accounts')
export class AccountController {
  private readonly logger: Logger;

  constructor(
    private readonly accountService: AccountService,
    private readonly tokenService: TokenService,
    private readonly nftService: NftService,
    private readonly delegationLegacyService: DelegationLegacyService,
    private readonly waitingListService: WaitingListService,
    private readonly stakeService: StakeService,
    private readonly transactionService: TransactionService,
    private readonly scResultService: SmartContractResultService,
    private readonly collectionService: CollectionService,
    private readonly transferService: TransferService,
    private readonly apiConfigService: ApiConfigService
  ) {
    this.logger = new Logger(AccountController.name);
  }

  @Get("/accounts")
  @ApiOperation({ summary: 'Accounts details', description: 'Returns all accounts available on blockchain. By default it returns 25 accounts' })
  @ApiOkResponse({ type: [Account] })
  @ApiQuery({ name: 'from', description: 'Number of items to skip for the result set', required: false })
  @ApiQuery({ name: 'size', description: 'Number of items to retrieve', required: false })
  getAccounts(
    @Query('from', new DefaultValuePipe(0), ParseIntPipe) from: number,
    @Query("size", new DefaultValuePipe(25), ParseIntPipe) size: number
  ): Promise<Account[]> {
    return this.accountService.getAccounts({ from, size });
  }

  @Get("/accounts/count")
  @ApiOperation({ summary: 'Total number of accounts', description: 'Returns total number of accounts available on blockchain' })
  @ApiOkResponse({ type: Number })
  async getAccountsCount(): Promise<number> {
    return await this.accountService.getAccountsCount();
  }

  @Get("/accounts/c")
  @ApiExcludeEndpoint()
  async getAccountsCountAlternative(): Promise<number> {
    return await this.accountService.getAccountsCount();
  }

  @Get("/accounts/:address")
  @ApiOperation({ summary: 'Account details', description: 'Returns account details for a given address' })
  @ApiOkResponse({ type: AccountDetailed })
  async getAccountDetails(@Param('address', ParseAddressPipe) address: string): Promise<AccountDetailed> {
    const account = await this.accountService.getAccount(address);
    if (!account) {
      throw new HttpException('Account not found', HttpStatus.NOT_FOUND);
    }

    return account;
  }

  @Get("/accounts/:address/deferred")
  @ApiOperation({ summary: 'Account deferred payment details', description: 'Returns deferred payments from legacy staking' })
  @ApiOkResponse({ type: [AccountDeferred] })
  async getAccountDeferred(@Param('address', ParseAddressPipe) address: string): Promise<AccountDeferred[]> {
    try {
      return await this.accountService.getDeferredAccount(address);
    } catch (error) {
      this.logger.error(`Error in getAccountDeferred for address ${address}`);
      this.logger.error(error);
      throw new HttpException('Account not found', HttpStatus.NOT_FOUND);
    }
  }

  @Get("/accounts/:address/tokens")
  @ApiOperation({ summary: 'Account tokens', description: 'Returns a list of all available fungible tokens for a given address, together with their balance' })
  @ApiQuery({ name: 'from', description: 'Number of items to skip for the result set', required: false })
  @ApiQuery({ name: 'size', description: 'Number of items to retrieve', required: false })
  @ApiQuery({ name: 'search', description: 'Search by collection identifier', required: false })
  @ApiQuery({ name: 'name', description: 'Search by token name', required: false })
  @ApiQuery({ name: 'identifier', description: 'Search by token identifier', required: false })
  @ApiQuery({ name: 'identifiers', description: 'A comma-separated list of identifiers to filter by', required: false })
  @ApiOkResponse({ type: [TokenWithBalance] })
  async getAccountTokens(
    @Param('address', ParseAddressPipe) address: string,
    @Query('from', new DefaultValuePipe(0), ParseIntPipe) from: number,
    @Query('size', new DefaultValuePipe(25), ParseIntPipe) size: number,
    @Query('search') search?: string,
    @Query('name') name?: string,
    @Query('identifier') identifier?: string,
    @Query('identifiers', ParseArrayPipe) identifiers?: string[],
  ): Promise<TokenWithBalance[]> {
    try {
      return await this.tokenService.getTokensForAddress(address, new QueryPagination({ from, size }), new TokenFilter({ search, name, identifier, identifiers }));
    } catch (error) {
      this.logger.error(`Error in getAccountTokens for address ${address}`);
      this.logger.error(error);
      // throw new HttpException('Account not found', HttpStatus.NOT_FOUND);
      return [];
    }
  }

  @Get("/accounts/:address/tokens/count")
  @ApiOperation({ summary: 'Account token count', description: 'Returns the total number of tokens for a given address' })
  @ApiOkResponse({ type: Number })
  async getTokenCount(@Param('address', ParseAddressPipe) address: string): Promise<number> {
    try {
      return await this.tokenService.getTokenCountForAddress(address);
    } catch (error) {
      this.logger.error(`Error in getTokenCount for address ${address}`);
      this.logger.error(error);
      // throw new HttpException('Account not found', HttpStatus.NOT_FOUND);
      return 0;
    }
  }

  @Get("/accounts/:address/tokens/c")
  @ApiExcludeEndpoint()
  async getTokenCountAlternative(@Param('address', ParseAddressPipe) address: string): Promise<number> {
    try {
      return await this.tokenService.getTokenCountForAddress(address);
    } catch (error) {
      this.logger.error(`Error in getTokenCount for address ${address}`);
      this.logger.error(error);
      // throw new HttpException('Account not found', HttpStatus.NOT_FOUND);
      return 0;
    }
  }

  @Get("/accounts/:address/tokens/:token")
  @ApiOkResponse({ type: TokenWithBalance })
  @ApiOperation({ summary: 'Account token details', description: 'Returns details about a specific fungible token from a given address' })
  async getAccountToken(
    @Param('address', ParseAddressPipe) address: string,
    @Param('token', ParseTokenPipe) token: string,
  ): Promise<TokenDetailedWithBalance> {
    const result = await this.tokenService.getTokenForAddress(address, token);
    if (!result) {
      throw new HttpException('Token for given account not found', HttpStatus.NOT_FOUND);
    }

    return result;
  }

  @Get("/accounts/:address/roles/collections")
  @ApiOperation({ summary: 'Account collections', description: 'Returns NFT/SFT/MetaESDT collections where the account is owner or has some special roles assigned to it' })
  @ApiQuery({ name: 'from', description: 'Number of items to skip for the result set', required: false })
  @ApiQuery({ name: 'size', description: 'Number of items to retrieve', required: false })
  @ApiQuery({ name: 'search', description: 'Search by collection identifier', required: false })
  @ApiQuery({ name: 'type', description: 'Filter by type (NonFungibleESDT/SemiFungibleESDT/MetaESDT)', required: false })
  @ApiQuery({ name: 'owner', description: 'Filter by collection owner', required: false })
  @ApiQuery({ name: 'canCreate', description: 'Filter by property canCreate (boolean)', required: false })
  @ApiQuery({ name: 'canBurn', description: 'Filter by property canBurn (boolean)', required: false })
  @ApiQuery({ name: 'canAddQuantity', description: 'Filter by property canAddQuantity (boolean)', required: false })
  @ApiQuery({ name: 'canUpdateAttributes', description: 'Filter by property canUpdateAttributes (boolean)', required: false })
  @ApiQuery({ name: 'canAddUri', description: 'Filter by property canAddUri (boolean)', required: false })
  @ApiQuery({ name: 'canTransferRole', description: 'Filter by property canTransferRole (boolean)', required: false })
  @ApiOkResponse({ type: [NftCollectionRole] })
  async getAccountCollectionsWithRoles(
    @Param('address', ParseAddressPipe) address: string,
    @Query('from', new DefaultValuePipe(0), ParseIntPipe) from: number,
    @Query('size', new DefaultValuePipe(25), ParseIntPipe) size: number,
    @Query('search') search?: string,
    @Query('type', new ParseOptionalEnumArrayPipe(NftType)) type?: NftType[],
    @Query('owner') owner?: string,
    @Query('canCreate', new ParseOptionalBoolPipe) canCreate?: boolean,
    @Query('canBurn', new ParseOptionalBoolPipe) canBurn?: boolean,
    @Query('canAddQuantity', new ParseOptionalBoolPipe) canAddQuantity?: boolean,
    @Query('canUpdateAttributes', new ParseOptionalBoolPipe) canUpdateAttributes?: boolean,
    @Query('canAddUri', new ParseOptionalBoolPipe) canAddUri?: boolean,
    @Query('canTransferRole', new ParseOptionalBoolPipe) canTransferRole?: boolean,
  ): Promise<NftCollectionRole[]> {
    return await this.collectionService.getCollectionsWithRolesForAddress(address, new CollectionFilter({ search, type, owner, canCreate, canBurn, canAddQuantity, canUpdateAttributes, canAddUri, canTransferRole }), new QueryPagination({ from, size }));
  }

  @Get("/accounts/:address/roles/collections/count")
  @ApiOperation({ summary: 'Account collection count', description: 'Returns the total number of NFT/SFT/MetaESDT collections where the account is owner or has some special roles assigned to it' })
  @ApiQuery({ name: 'search', description: 'Search by collection identifier', required: false })
  @ApiQuery({ name: 'type', description: 'Filter by type (NonFungibleESDT/SemiFungibleESDT/MetaESDT)', required: false })
  @ApiQuery({ name: 'owner', description: 'Filter by collection owner', required: false })
  @ApiQuery({ name: 'canCreate', description: 'Filter by property canCreate (boolean)', required: false })
  @ApiQuery({ name: 'canBurn', description: 'Filter by property canCreate (boolean)', required: false })
  @ApiQuery({ name: 'canAddQuantity', description: 'Filter by property canAddQuantity (boolean)', required: false })
  @ApiOkResponse({ type: Number })
  async getCollectionWithRolesCount(
    @Param('address', ParseAddressPipe) address: string,
    @Query('search') search?: string,
    @Query('type', new ParseOptionalEnumArrayPipe(NftType)) type?: NftType[],
    @Query('owner', ParseAddressPipe) owner?: string,
    @Query('canCreate', new ParseOptionalBoolPipe) canCreate?: boolean,
    @Query('canBurn', new ParseOptionalBoolPipe) canBurn?: boolean,
    @Query('canAddQuantity', new ParseOptionalBoolPipe) canAddQuantity?: boolean,
  ): Promise<number> {
    return await this.collectionService.getCollectionCountForAddressWithRoles(address, new CollectionFilter({ search, type, owner, canCreate, canBurn, canAddQuantity }));
  }

  @Get("/accounts/:address/roles/collections/c")
  @ApiExcludeEndpoint()
  async getCollectionCountAlternative(
    @Param('address', ParseAddressPipe) address: string,
    @Query('search') search?: string,
    @Query('type', new ParseOptionalEnumArrayPipe(NftType)) type?: NftType[],
    @Query('owner', ParseAddressPipe) owner?: string,
    @Query('canCreate', new ParseOptionalBoolPipe) canCreate?: boolean,
    @Query('canBurn', new ParseOptionalBoolPipe) canBurn?: boolean,
    @Query('canAddQuantity', new ParseOptionalBoolPipe) canAddQuantity?: boolean,
  ): Promise<number> {
    return await this.collectionService.getCollectionCountForAddressWithRoles(address, new CollectionFilter({ search, type, owner, canCreate, canBurn, canAddQuantity }));
  }

  @Get("/accounts/:address/roles/collections/:collection")
  @ApiOperation({ summary: 'Account collection details', description: 'Returns details about a specific NFT/SFT/MetaESDT collection from a given address' })
  @ApiOkResponse({ type: NftCollectionRole })
  async getAccountCollection(
    @Param('address', ParseAddressPipe) address: string,
    @Param('collection', ParseCollectionPipe) collection: string,
  ): Promise<NftCollectionRole> {
    const result = await this.collectionService.getCollectionForAddressWithRole(address, collection);
    if (!result) {
      throw new NotFoundException('Collection for given account not found');
    }

    return result;
  }

  @Get("/accounts/:address/roles/tokens")
  @ApiOperation({ summary: 'Account token roles', description: 'Returns fungible token roles where the account is owner or has some special roles assigned to it' })
  @ApiQuery({ name: 'from', description: 'Number of items to skip for the result set', required: false })
  @ApiQuery({ name: 'size', description: 'Number of items to retrieve', required: false })
  @ApiQuery({ name: 'search', description: 'Search by token identifier or name', required: false })
  @ApiQuery({ name: 'owner', description: 'Filter by token owner', required: false })
  @ApiQuery({ name: 'canMint', description: 'Filter by property canMint (boolean)', required: false })
  @ApiQuery({ name: 'canBurn', description: 'Filter by property canBurn (boolean)', required: false })
  @ApiOkResponse({ type: [TokenWithRoles] })
  async getAccountTokensWithRoles(
    @Param('address', ParseAddressPipe) address: string,
    @Query('from', new DefaultValuePipe(0), ParseIntPipe) from: number,
    @Query('size', new DefaultValuePipe(25), ParseIntPipe) size: number,
    @Query('search') search?: string,
    @Query('owner', ParseAddressPipe) owner?: string,
    @Query('canMint', new ParseOptionalBoolPipe) canMint?: boolean,
    @Query('canBurn', new ParseOptionalBoolPipe) canBurn?: boolean,
  ): Promise<TokenWithRoles[]> {
    return await this.tokenService.getTokensWithRolesForAddress(address, new TokenWithRolesFilter({ search, owner, canMint, canBurn }), new QueryPagination({ from, size }));
  }

  @Get("/accounts/:address/roles/tokens/count")
  @ApiOperation({ summary: 'Account token roles count', description: 'Returns the total number of fungible token roles where the account is owner or has some special roles assigned to it' })
  @ApiQuery({ name: 'search', description: 'Search by token identifier or name', required: false })
  @ApiQuery({ name: 'owner', description: 'Filter by token owner', required: false })
  @ApiQuery({ name: 'canMint', description: 'Filter by property canMint (boolean)', required: false })
  @ApiQuery({ name: 'canBurn', description: 'Filter by property canCreate (boolean)', required: false })
  @ApiQuery({ name: 'canAddQuantity', description: 'Filter by property canAddQuantity (boolean)', required: false })
  @ApiOkResponse({ type: Number })
  async getTokensWithRolesCount(
    @Param('address', ParseAddressPipe) address: string,
    @Query('search') search?: string,
    @Query('owner', ParseAddressPipe) owner?: string,
    @Query('canMint', new ParseOptionalBoolPipe) canMint?: boolean,
    @Query('canBurn', new ParseOptionalBoolPipe) canBurn?: boolean,
  ): Promise<number> {
    return await this.tokenService.getTokensWithRolesForAddressCount(address, new TokenWithRolesFilter({ search, owner, canMint, canBurn }));
  }

  @Get("/accounts/:address/roles/tokens/c")
  @ApiExcludeEndpoint()
  async getTokensWithRolesCountAlternative(
    @Param('address', ParseAddressPipe) address: string,
    @Query('search') search?: string,
    @Query('owner', ParseAddressPipe) owner?: string,
    @Query('canMint', new ParseOptionalBoolPipe) canMint?: boolean,
    @Query('canBurn', new ParseOptionalBoolPipe) canBurn?: boolean,
  ): Promise<number> {
    return await this.tokenService.getTokensWithRolesForAddressCount(address, new TokenWithRolesFilter({ search, owner, canMint, canBurn }));
  }

  @Get("/accounts/:address/roles/tokens/:identifier")
  @ApiOperation({ summary: 'Account token roles details', description: 'Returns details about fungible token roles where the account is owner or has some special roles assigned to it' })
  @ApiOkResponse({ type: TokenWithRoles })
  async getTokenWithRoles(
    @Param('address', ParseAddressPipe) address: string,
    @Param('identifier', ParseTokenPipe) identifier: string,
  ): Promise<TokenWithRoles> {
    const result = await this.tokenService.getTokenWithRolesForAddress(address, identifier);
    if (!result) {
      throw new NotFoundException('Token with roles for given account not found');
    }

    return result;
  }

  @Get("/accounts/:address/collections")
  @ApiOperation({ summary: 'Account collections', description: 'Returns NFT/SFT/MetaESDT collections where the account owns one or more NFTs' })
  @ApiQuery({ name: 'from', description: 'Number of items to skip for the result set', required: false })
  @ApiQuery({ name: 'size', description: 'Number of items to retrieve', required: false })
  @ApiQuery({ name: 'search', description: 'Search by collection identifier', required: false })
  @ApiQuery({ name: 'type', description: 'Filter by type (NonFungibleESDT/SemiFungibleESDT/MetaESDT)', required: false })
  @ApiOkResponse({ type: [NftCollectionAccount] })
  async getAccountNftCollections(
    @Param('address', ParseAddressPipe) address: string,
    @Query('from', new DefaultValuePipe(0), ParseIntPipe) from: number,
    @Query('size', new DefaultValuePipe(25), ParseIntPipe) size: number,
    @Query('search') search?: string,
    @Query('type', new ParseOptionalEnumArrayPipe(NftType)) type?: NftType[],
  ): Promise<NftCollectionAccount[]> {
    return await this.collectionService.getCollectionsForAddress(address, new CollectionFilter({ search, type }), new QueryPagination({ from, size }));
  }

  @Get("/accounts/:address/collections/count")
  @ApiOperation({ summary: 'Account collection count', description: 'Returns the total number of NFT/SFT/MetaESDT collections where the account is owner or has some special roles assigned to it' })
  @ApiQuery({ name: 'search', description: 'Search by collection identifier', required: false })
  @ApiQuery({ name: 'type', description: 'Filter by type (NonFungibleESDT/SemiFungibleESDT/MetaESDT)', required: false })
  @ApiOkResponse({ type: Number })
  async getNftCollectionCount(
    @Param('address', ParseAddressPipe) address: string,
    @Query('search') search?: string,
    @Query('type', new ParseOptionalEnumArrayPipe(NftType)) type?: NftType[],
  ): Promise<number> {
    return await this.collectionService.getCollectionCountForAddress(address, new CollectionFilter({ search, type }));
  }

  @Get("/accounts/:address/collections/c")
  @ApiExcludeEndpoint()
  async getNftCollectionCountAlternative(
    @Param('address', ParseAddressPipe) address: string,
    @Query('search') search?: string,
    @Query('type', new ParseOptionalEnumArrayPipe(NftType)) type?: NftType[],
  ): Promise<number> {
    return await this.collectionService.getCollectionCountForAddress(address, new CollectionFilter({ search, type }));
  }

  @Get("/accounts/:address/collections/:collection")
  @ApiOperation({ summary: 'Account collection details', description: 'Returns details about a specific NFT/SFT/MetaESDT collection from a given address' })
  @ApiOkResponse({ type: NftCollectionAccount })
  async getAccountNftCollection(
    @Param('address', ParseAddressPipe) address: string,
    @Param('collection', ParseCollectionPipe) collection: string,
  ): Promise<NftCollectionAccount> {
    const result = await this.collectionService.getCollectionForAddress(address, collection);
    if (!result) {
      throw new NotFoundException('Collection for given account not found');
    }

    return result;
  }

  @Get("/accounts/:address/nfts")
  @ApiOperation({ summary: 'Account NFTs', description: 'Returns a list of all available NFTs/SFTs owned by the provided address' })
  @ApiQuery({ name: 'from', description: 'Number of items to skip for the result set', required: false })
  @ApiQuery({ name: 'size', description: 'Number of items to retrieve', required: false })
  @ApiQuery({ name: 'search', description: 'Search by collection identifier', required: false })
  @ApiQuery({ name: 'identifiers', description: 'Filter by identifiers, comma-separated', required: false })
  @ApiQuery({ name: 'type', description: 'Filter by type (NonFungibleESDT/SemiFungibleESDT)', required: false })
  @ApiQuery({ name: 'collection', description: 'Get all tokens by token collection. Deprecated, replaced by collections parameter', required: false, deprecated: true })
  @ApiQuery({ name: 'collections', description: 'Get all tokens by token collections, comma-separated', required: false })
  @ApiQuery({ name: 'name', description: 'Get all nfts by name', required: false })
  @ApiQuery({ name: 'tags', description: 'Filter by one or more comma-separated tags', required: false })
  @ApiQuery({ name: 'creator', description: 'Return all NFTs associated with a given creator', required: false })
  @ApiQuery({ name: 'hasUris', description: 'Return all NFTs that have one or more uris', required: false })
  @ApiQuery({ name: 'includeFlagged', description: 'Include NFTs that are flagged or not', required: false })
  @ApiQuery({ name: 'withSupply', description: 'Return supply where type = SemiFungibleESDT', required: false })
  @ApiQuery({ name: 'source', description: 'Data source of request', required: false })
  @ApiOkResponse({ type: [NftAccount] })
  async getAccountNfts(
    @Param('address', ParseAddressPipe) address: string,
    @Query('from', new DefaultValuePipe(0), ParseIntPipe) from: number,
    @Query('size', new DefaultValuePipe(25), ParseIntPipe) size: number,
    @Query('search') search?: string,
    @Query('identifiers', ParseArrayPipe) identifiers?: string[],
    @Query('type') type?: NftType,
    @Query('collection') collection?: string,
    @Query('collections', ParseArrayPipe) collections?: string[],
    @Query('name') name?: string,
    @Query('tags', ParseArrayPipe) tags?: string[],
    @Query('creator', ParseAddressPipe) creator?: string,
    @Query('hasUris', new ParseOptionalBoolPipe) hasUris?: boolean,
    @Query('includeFlagged', new ParseOptionalBoolPipe) includeFlagged?: boolean,
    @Query('withSupply', new ParseOptionalBoolPipe) withSupply?: boolean,
    @Query('source', new ParseOptionalEnumPipe(EsdtDataSource)) source?: EsdtDataSource,
  ): Promise<NftAccount[]> {
    return await this.nftService.getNftsForAddress(
      address,
      new QueryPagination({ from, size }),
      new NftFilter({ search, identifiers, type, collection, name, collections, tags, creator, hasUris, includeFlagged }),
      new NftQueryOptions({ withSupply }),
      source
    );
  }

  @Get("/accounts/:address/nfts/count")
  @ApiOperation({ summary: 'Account NFT/SFT tokens count', description: 'Returns the total number of NFT/SFT tokens from a given address, as well as the total number of a certain type of ESDT ' })
  @ApiQuery({ name: 'search', description: 'Search by collection identifier', required: false })
  @ApiQuery({ name: 'identifiers', description: 'Filter by identifiers, comma-separated', required: false })
  @ApiQuery({ name: 'type', description: 'Filter by type (NonFungibleESDT/SemiFungibleESDT/MetaESDT)', required: false })
  @ApiQuery({ name: 'collection', description: 'Get all tokens by token collection', required: false })
  @ApiQuery({ name: 'collections', description: 'Get all tokens by token collections, comma-separated', required: false })
  @ApiQuery({ name: 'name', description: 'Get all nfts by name', required: false })
  @ApiQuery({ name: 'tags', description: 'Filter by one or more comma-separated tags', required: false })
  @ApiQuery({ name: 'creator', description: 'Return all NFTs associated with a given creator', required: false })
  @ApiQuery({ name: 'hasUris', description: 'Return all NFTs that have one or more uris', required: false })
  @ApiQuery({ name: 'includeFlagged', description: 'Include NFTs that are flagged or not', required: false })
  @ApiOkResponse({ type: Number })
  async getNftCount(
    @Param('address', ParseAddressPipe) address: string,
    @Query('identifiers', ParseArrayPipe) identifiers?: string[],
    @Query('search') search?: string,
    @Query('type') type?: NftType,
    @Query('collection') collection?: string,
    @Query('collections', ParseArrayPipe) collections?: string[],
    @Query('name') name?: string,
    @Query('tags', ParseArrayPipe) tags?: string[],
    @Query('creator', ParseAddressPipe) creator?: string,
    @Query('hasUris', new ParseOptionalBoolPipe) hasUris?: boolean,
    @Query('includeFlagged', new ParseOptionalBoolPipe) includeFlagged?: boolean,
  ): Promise<number> {
    return await this.nftService.getNftCountForAddress(address, new NftFilter({ search, identifiers, type, collection, collections, name, tags, creator, hasUris, includeFlagged }));
  }

  @Get("/accounts/:address/nfts/c")
  @ApiExcludeEndpoint()
  async getNftCountAlternative(
    @Param('address', ParseAddressPipe) address: string,
    @Query('search') search?: string,
    @Query('identifiers', ParseArrayPipe) identifiers?: string[],
    @Query('type') type?: NftType,
    @Query('collection') collection?: string,
    @Query('collections', ParseArrayPipe) collections?: string[],
    @Query('name') name?: string,
    @Query('tags', ParseArrayPipe) tags?: string[],
    @Query('creator', ParseAddressPipe) creator?: string,
    @Query('hasUris', new ParseOptionalBoolPipe) hasUris?: boolean,
    @Query('includeFlagged', new ParseOptionalBoolPipe) includeFlagged?: boolean,
  ): Promise<number> {
    return await this.nftService.getNftCountForAddress(address, new NftFilter({ search, identifiers, type, collection, collections, name, tags, creator, hasUris, includeFlagged }));
  }

  @Get("/accounts/:address/nfts/:nft")
  @ApiOperation({ summary: 'Account NFT/SFT token details', description: 'Returns details about a specific fungible token for a given address' })
  @ApiOkResponse({ type: NftAccount })
  async getAccountNft(
    @Param('address', ParseAddressPipe) address: string,
    @Param('nft', ParseNftPipe) nft: string,
  ): Promise<NftAccount> {
    const result = await this.nftService.getNftForAddress(address, nft);
    if (!result) {
      throw new HttpException('Token for given account not found', HttpStatus.NOT_FOUND);
    }

    return result;
  }

  @Get("/accounts/:address/stake")
  @ApiOperation({ summary: 'Account stake details', description: 'Summarizes total staked amount for the given provider, as well as when and how much unbond will be performed' })
  @ApiOkResponse({ type: ProviderStake })
  async getAccountStake(@Param('address', ParseAddressPipe) address: string): Promise<ProviderStake> {
    return await this.stakeService.getStakeForAddress(address);
  }

  @Get("/accounts/:address/delegation-legacy")
  @ApiOperation({ summary: 'Account legacy delegation details', description: 'Returns staking information related to the legacy delegation pool' })
  @ApiOkResponse({ type: AccountDelegationLegacy })
  async getAccountDelegationLegacy(@Param('address', ParseAddressPipe) address: string): Promise<AccountDelegationLegacy> {
    return await this.delegationLegacyService.getDelegationForAddress(address);
  }

  @Get("/accounts/:address/keys")
  @ApiOperation({ summary: 'Account nodes', description: 'Returns all active / queued nodes where the account is owner' })
  @ApiOkResponse({ type: [AccountKey] })
  async getAccountKeys(@Param('address', ParseAddressPipe) address: string): Promise<AccountKey[]> {
    return await this.accountService.getKeys(address);
  }

  @Get("/accounts/:address/waiting-list")
  @ApiOperation({ summary: 'Account queued nodes', description: 'Returns all nodes in the node queue where the account is owner' })
  @ApiOkResponse({ type: [WaitingList] })
  async getAccountWaitingList(@Param('address', ParseAddressPipe) address: string): Promise<WaitingList[]> {
    return await this.waitingListService.getWaitingListForAddress(address);
  }

  @Get("/accounts/:address/transactions")
  @ApiOperation({ summary: 'Account transaction list', description: 'Returns details of all transactions where the account is sender or receiver' })
  @ApiOkResponse({ type: [Transaction] })
  @ApiQuery({ name: 'from', description: 'Number of items to skip for the result set', required: false })
  @ApiQuery({ name: 'size', description: 'Number of items to retrieve', required: false })
  @ApiQuery({ name: 'sender', description: 'Address of the transaction sender', required: false })
  @ApiQuery({ name: 'receiver', description: 'Address of the transaction receiver', required: false })
  @ApiQuery({ name: 'token', description: 'Identifier of the token', required: false })
  @ApiQuery({ name: 'senderShard', description: 'Id of the shard the sender address belongs to', required: false })
  @ApiQuery({ name: 'receiverShard', description: 'Id of the shard the receiver address belongs to', required: false })
  @ApiQuery({ name: 'miniBlockHash', description: 'Filter by miniblock hash', required: false })
  @ApiQuery({ name: 'hashes', description: 'Filter by a comma-separated list of transaction hashes', required: false })
  @ApiQuery({ name: 'status', description: 'Status of the transaction (success / pending / invalid / fail)', required: false, enum: TransactionStatus })
  @ApiQuery({ name: 'search', description: 'Search in data object', required: false })
  @ApiQuery({ name: 'order', description: 'Sort order (asc/desc)', required: false, enum: SortOrder })
  @ApiQuery({ name: 'before', description: 'Before timestamp', required: false })
  @ApiQuery({ name: 'after', description: 'After timestamp', required: false })
  @ApiQuery({ name: 'withScResults', description: 'Return scResults for transactions', required: false })
  @ApiQuery({ name: 'withOperations', description: 'Return operations for transactions', required: false })
  @ApiQuery({ name: 'withLogs', description: 'Return logs for transactions', required: false })
  async getAccountTransactions(
    @Param('address', ParseAddressPipe) address: string,
    @Query('from', new DefaultValuePipe(0), ParseIntPipe) from: number,
    @Query('size', new DefaultValuePipe(25), ParseIntPipe) size: number,
    @Query('sender', ParseAddressPipe) sender?: string,
    @Query('receiver', ParseAddressPipe) receiver?: string,
    @Query('token', ParseTokenPipe) token?: string,
    @Query('senderShard', ParseOptionalIntPipe) senderShard?: number,
    @Query('receiverShard', ParseOptionalIntPipe) receiverShard?: number,
    @Query('miniBlockHash', ParseBlockHashPipe) miniBlockHash?: string,
    @Query('hashes', ParseArrayPipe) hashes?: string[],
    @Query('status', new ParseOptionalEnumPipe(TransactionStatus)) status?: TransactionStatus,
    @Query('search') search?: string,
    @Query('before', ParseOptionalIntPipe) before?: number,
    @Query('after', ParseOptionalIntPipe) after?: number,
    @Query('order', new ParseOptionalEnumPipe(SortOrder)) order?: SortOrder,
    @Query('withScResults', new ParseOptionalBoolPipe) withScResults?: boolean,
    @Query('withOperations', new ParseOptionalBoolPipe) withOperations?: boolean,
    @Query('withLogs', new ParseOptionalBoolPipe) withLogs?: boolean,
  ) {
    if ((withScResults === true || withOperations === true || withLogs) && size > 50) {
      throw new BadRequestException(`Maximum size of 50 is allowed when activating flags 'withScResults', 'withOperations' or 'withLogs'`);
    }

    return await this.transactionService.getTransactions(new TransactionFilter({
      sender,
      receiver,
      token,
      senderShard,
      receiverShard,
      miniBlockHash,
      hashes,
      status,
      search,
      before,
      after,
      order,
    }), new QueryPagination({ from, size }), new TransactionQueryOptions({ withScResults, withOperations, withLogs }), address);
  }

  @Get("/accounts/:address/transactions/count")
  @ApiOperation({ summary: 'Account transactions count', description: 'Returns total number of transactions for a given address where the account is sender or receiver, as well as total transactions count that have a certain status' })
  @ApiOkResponse({ type: Number })
  @ApiQuery({ name: 'sender', description: 'Address of the transaction sender', required: false })
  @ApiQuery({ name: 'receiver', description: 'Address of the transaction receiver', required: false })
  @ApiQuery({ name: 'token', description: 'Identifier of the token', required: false })
  @ApiQuery({ name: 'senderShard', description: 'Id of the shard the sender address belongs to', required: false })
  @ApiQuery({ name: 'receiverShard', description: 'Id of the shard the receiver address belongs to', required: false })
  @ApiQuery({ name: 'miniBlockHash', description: 'Filter by miniblock hash', required: false })
  @ApiQuery({ name: 'hashes', description: 'Filter by a comma-separated list of transaction hashes', required: false })
  @ApiQuery({ name: 'status', description: 'Status of the transaction (success / pending / invalid / fail)', required: false, enum: TransactionStatus })
  @ApiQuery({ name: 'search', description: 'Search in data object', required: false })
  @ApiQuery({ name: 'function', description: 'Filter transactions by function name', required: false })
  @ApiQuery({ name: 'before', description: 'Before timestamp', required: false })
  @ApiQuery({ name: 'after', description: 'After timestamp', required: false })
  async getAccountTransactionsCount(
    @Param('address', ParseAddressPipe) address: string,
    @Query('sender', ParseAddressPipe) sender?: string,
    @Query('receiver', ParseAddressPipe) receiver?: string,
    @Query('token') token?: string,
    @Query('senderShard', ParseOptionalIntPipe) senderShard?: number,
    @Query('receiverShard', ParseOptionalIntPipe) receiverShard?: number,
    @Query('miniBlockHash', ParseBlockHashPipe) miniBlockHash?: string,
    @Query('hashes', ParseArrayPipe) hashes?: string[],
    @Query('status', new ParseOptionalEnumPipe(TransactionStatus)) status?: TransactionStatus,
    @Query('search') search?: string,
    @Query('function') scFunction?: string,
    @Query('before', ParseOptionalIntPipe) before?: number,
    @Query('after', ParseOptionalIntPipe) after?: number,
  ): Promise<number> {
    return await this.transactionService.getTransactionCount(new TransactionFilter({
      sender,
      receiver,
      token,
      function: scFunction,
      senderShard,
      receiverShard,
      miniBlockHash,
      hashes,
      status,
      search,
      before,
      after,
    }), address);
  }

  @Get("/accounts/:address/transfers")
  @ApiOperation({ summary: 'Account value transfers', description: 'Returns both transfers triggerred by a user account (type = Transaction), as well as transfers triggerred by smart contracts (type = SmartContractResult), thus providing a full picture of all in/out value transfers for a given account' })
  @ApiOkResponse({ type: [Transaction] })
  @ApiQuery({ name: 'from', description: 'Number of items to skip for the result set', required: false })
  @ApiQuery({ name: 'size', description: 'Number of items to retrieve', required: false })
  @ApiQuery({ name: 'sender', description: 'Address of the transfer sender', required: false })
  @ApiQuery({ name: 'receiver', description: 'Address of the transfer receiver', required: false })
  @ApiQuery({ name: 'token', description: 'Identifier of the token', required: false })
  @ApiQuery({ name: 'senderShard', description: 'Id of the shard the sender address belongs to', required: false })
  @ApiQuery({ name: 'receiverShard', description: 'Id of the shard the receiver address belongs to', required: false })
  @ApiQuery({ name: 'miniBlockHash', description: 'Filter by miniblock hash', required: false })
  @ApiQuery({ name: 'hashes', description: 'Filter by a comma-separated list of transfer hashes', required: false })
  @ApiQuery({ name: 'status', description: 'Status of the transaction (success / pending / invalid / fail)', required: false, enum: TransactionStatus })
  @ApiQuery({ name: 'search', description: 'Search in data object', required: false })
  @ApiQuery({ name: 'order', description: 'Sort order (asc/desc)', required: false, enum: SortOrder })
  @ApiQuery({ name: 'before', description: 'Before timestamp', required: false })
  @ApiQuery({ name: 'after', description: 'After timestamp', required: false })
  async getAccountTransfers(
    @Param('address', ParseAddressPipe) address: string,
    @Query('from', new DefaultValuePipe(0), ParseIntPipe) from: number,
    @Query('size', new DefaultValuePipe(25), ParseIntPipe) size: number,
    @Query('sender', ParseAddressPipe) sender?: string,
    @Query('receiver', ParseAddressPipe) receiver?: string,
    @Query('token') token?: string,
    @Query('senderShard', ParseOptionalIntPipe) senderShard?: number,
    @Query('receiverShard', ParseOptionalIntPipe) receiverShard?: number,
    @Query('miniBlockHash', ParseBlockHashPipe) miniBlockHash?: string,
    @Query('hashes', ParseArrayPipe) hashes?: string[],
    @Query('status', new ParseOptionalEnumPipe(TransactionStatus)) status?: TransactionStatus,
    @Query('search') search?: string,
    @Query('before', ParseOptionalIntPipe) before?: number,
    @Query('after', ParseOptionalIntPipe) after?: number,
    @Query('order', new ParseOptionalEnumPipe(SortOrder)) order?: SortOrder,
  ): Promise<Transaction[]> {
    if (!this.apiConfigService.getIsIndexerV3FlagActive()) {
      throw new HttpException('Endpoint not live yet', HttpStatus.NOT_IMPLEMENTED);
    }

    return await this.transferService.getTransfers(new TransactionFilter({
      address,
      sender,
      receiver,
      token,
      senderShard,
      receiverShard,
      miniBlockHash,
      hashes,
      status,
      search,
      before,
      after,
      order,
    }), new QueryPagination({ from, size }));
  }

  @Get("/accounts/:address/transfers/count")
  @ApiOperation({ summary: 'Account transfer count', description: 'Return total count of tranfers triggerred by a user account (type = Transaction), as well as transfers triggerred by smart contracts (type = SmartContractResult)' })
  @ApiOkResponse({ type: Number })
  @ApiQuery({ name: 'sender', description: 'Address of the transfer sender', required: false })
  @ApiQuery({ name: 'receiver', description: 'Address of the transfer receiver', required: false })
  @ApiQuery({ name: 'token', description: 'Identifier of the token', required: false })
  @ApiQuery({ name: 'senderShard', description: 'Id of the shard the sender address belongs to', required: false })
  @ApiQuery({ name: 'receiverShard', description: 'Id of the shard the receiver address belongs to', required: false })
  @ApiQuery({ name: 'miniBlockHash', description: 'Filter by miniblock hash', required: false })
  @ApiQuery({ name: 'hashes', description: 'Filter by a comma-separated list of transfer hashes', required: false })
  @ApiQuery({ name: 'status', description: 'Status of the transaction (success / pending / invalid / fail)', required: false, enum: TransactionStatus })
  @ApiQuery({ name: 'search', description: 'Search in data object', required: false })
  @ApiQuery({ name: 'function', description: 'Filter transfers by function name', required: false })
  @ApiQuery({ name: 'before', description: 'Before timestamp', required: false })
  @ApiQuery({ name: 'after', description: 'After timestamp', required: false })
  async getAccountTransfersCount(
    @Param('address', ParseAddressPipe) address: string,
    @Query('sender', ParseAddressPipe) sender?: string,
    @Query('receiver', ParseAddressPipe) receiver?: string,
    @Query('token') token?: string,
    @Query('senderShard', ParseOptionalIntPipe) senderShard?: number,
    @Query('receiverShard', ParseOptionalIntPipe) receiverShard?: number,
    @Query('miniBlockHash', ParseBlockHashPipe) miniBlockHash?: string,
    @Query('hashes', ParseArrayPipe) hashes?: string[],
    @Query('status', new ParseOptionalEnumPipe(TransactionStatus)) status?: TransactionStatus,
    @Query('search') search?: string,
    @Query('function') scFunction?: string,
    @Query('before', ParseOptionalIntPipe) before?: number,
    @Query('after', ParseOptionalIntPipe) after?: number,
  ): Promise<number> {
    if (!this.apiConfigService.getIsIndexerV3FlagActive()) {
      throw new HttpException('Endpoint not live yet', HttpStatus.NOT_IMPLEMENTED);
    }

    return await this.transferService.getTransfersCount(new TransactionFilter({
      address,
      sender,
      receiver,
      token,
      function: scFunction,
      senderShard,
      receiverShard,
      miniBlockHash,
      hashes,
      status,
      search,
      before,
      after,
    }));
  }

  @Get("/accounts/:address/transfers/c")
  @ApiExcludeEndpoint()
  async getAccountTransfersCountAlternative(
    @Param('address', ParseAddressPipe) address: string,
    @Query('sender', ParseAddressPipe) sender?: string,
    @Query('receiver', ParseAddressPipe) receiver?: string,
    @Query('token') token?: string,
    @Query('senderShard', ParseOptionalIntPipe) senderShard?: number,
    @Query('receiverShard', ParseOptionalIntPipe) receiverShard?: number,
    @Query('miniBlockHash', ParseBlockHashPipe) miniBlockHash?: string,
    @Query('hashes', ParseArrayPipe) hashes?: string[],
    @Query('status', new ParseOptionalEnumPipe(TransactionStatus)) status?: TransactionStatus,
    @Query('search') search?: string,
    @Query('function') scFunction?: string,
    @Query('before', ParseOptionalIntPipe) before?: number,
    @Query('after', ParseOptionalIntPipe) after?: number,
  ): Promise<number> {
    if (!this.apiConfigService.getIsIndexerV3FlagActive()) {
      throw new HttpException('Endpoint not live yet', HttpStatus.NOT_IMPLEMENTED);
    }

    return await this.transferService.getTransfersCount(new TransactionFilter({
      address,
      sender,
      receiver,
      token,
      function: scFunction,
      senderShard,
      receiverShard,
      miniBlockHash,
      hashes,
      status,
      search,
      before,
      after,
    }));
  }

  @Get("/accounts/:address/contracts")
  @ApiOperation({ summary: 'Account smart contracts details', description: 'Returns smart contracts details for a given account' })
  @ApiQuery({ name: 'from', description: 'Number of items to skip for the result set', required: false })
  @ApiQuery({ name: 'size', description: 'Number of items to retrieve', required: false })
  @ApiOkResponse({ type: [DeployedContract] })
  getAccountContracts(
    @Param('address', ParseAddressPipe) address: string,
    @Query('from', new DefaultValuePipe(0), ParseIntPipe) from: number,
    @Query('size', new DefaultValuePipe(25), ParseIntPipe) size: number,
  ): Promise<DeployedContract[]> {
    return this.accountService.getAccountContracts(new QueryPagination({ from, size }), address);
  }

  @Get("/accounts/:address/contracts/count")
  @ApiOperation({ summary: 'Account contracts count', description: 'Returns total number of deployed contracts for a given address' })
  @ApiOkResponse({ type: Number })
  getAccountContractsCount(@Param('address', ParseAddressPipe) address: string): Promise<number> {
    return this.accountService.getAccountContractsCount(address);
  }

  @Get("/accounts/:address/contracts/c")
  @ApiExcludeEndpoint()
  getAccountContractsCountAlternative(@Param('address', ParseAddressPipe) address: string): Promise<number> {
    return this.accountService.getAccountContractsCount(address);
  }

  @Get("/accounts/:address/results")
  @ApiOperation({ summary: 'Account smart contract results', description: 'Returns smart contract results where the account is sender or receiver' })
  @ApiQuery({ name: 'from', description: 'Number of items to skip for the result set', required: false })
  @ApiQuery({ name: 'size', description: 'Number of items to retrieve', required: false })
  @ApiOkResponse({ type: [SmartContractResult] })
  getAccountScResults(
    @Param('address', ParseAddressPipe) address: string,
    @Query('from', new DefaultValuePipe(0), ParseIntPipe) from: number,
    @Query('size', new DefaultValuePipe(25), ParseIntPipe) size: number,
  ): Promise<SmartContractResult[]> {
    return this.scResultService.getAccountScResults(address, new QueryPagination({ from, size }));
  }

  @Get("/accounts/:address/results/count")
  @ApiOperation({ summary: 'Account smart contracts results count', description: 'Returns number of smart contract results where the account is sender or receiver' })
  @ApiOkResponse({ type: Number })
  getAccountScResultsCount(
    @Param('address', ParseAddressPipe) address: string,
  ): Promise<number> {
    return this.scResultService.getAccountScResultsCount(address);
  }

  @Get("/accounts/:address/results/:scHash")
  @ApiOperation({ summary: 'Account smart contract result', description: 'Returns details of a smart contract result where the account is sender or receiver' })
  @ApiOkResponse({ type: SmartContractResult })
  async getAccountScResult(
    @Param('address', ParseAddressPipe) address: string,
    @Param('scHash', ParseTransactionHashPipe) scHash: string,
  ): Promise<SmartContractResult> {
    const scResult = await this.scResultService.getScResult(scHash);
    if (!scResult || (scResult.sender !== address && scResult.receiver !== address)) {
      throw new NotFoundException('Smart contract result not found');
    }

    return scResult;
  }

  @Get("/accounts/:address/sc-results")
  @ApiOperation({ summary: 'Account smart contract results', description: 'Returns smart contract results where the account is sender or receiver', deprecated: true })
  @ApiQuery({ name: 'from', description: 'Number of items to skip for the result set', required: false })
  @ApiQuery({ name: 'size', description: 'Number of items to retrieve', required: false })
  @ApiOkResponse({ type: [SmartContractResult] })
  getAccountScResultsDeprecated(
    @Param('address', ParseAddressPipe) address: string,
    @Query('from', new DefaultValuePipe(0), ParseIntPipe) from: number,
    @Query('size', new DefaultValuePipe(25), ParseIntPipe) size: number,
  ): Promise<SmartContractResult[]> {
    return this.scResultService.getAccountScResults(address, new QueryPagination({ from, size }));
  }

  @Get("/accounts/:address/sc-results/count")
  @ApiOperation({ summary: 'Account smart contracts results count', description: 'Returns number of smart contract results where the account is sender or receiver', deprecated: true })
  @ApiOkResponse({ type: Number })
  getAccountScResultsCountDeprecated(
    @Param('address', ParseAddressPipe) address: string,
  ): Promise<number> {
    return this.scResultService.getAccountScResultsCount(address);
  }

  @Get("/accounts/:address/sc-results/:scHash")
  @ApiOperation({ summary: 'Account smart contract result', description: 'Returns details of a smart contract result where the account is sender or receiver', deprecated: true })
  @ApiOkResponse({ type: SmartContractResult })
  async getAccountScResultDeprecated(
    @Param('address', ParseAddressPipe) address: string,
    @Param('scHash', ParseTransactionHashPipe) scHash: string,
  ): Promise<SmartContractResult> {
    const scResult = await this.scResultService.getScResult(scHash);
    if (!scResult || (scResult.sender !== address && scResult.receiver !== address)) {
      throw new NotFoundException('Smart contract result not found');
    }

    return scResult;
  }

  @Get("/accounts/:address/history")
  @ApiOperation({ summary: 'Account history', description: 'Return account EGLD balance history' })
  @ApiQuery({ name: 'from', description: 'Number of items to skip for the result set', required: false })
  @ApiQuery({ name: 'size', description: 'Number of items to retrieve', required: false })
  @ApiOkResponse({ type: [AccountHistory] })
  getAccountHistory(
    @Param('address', ParseAddressPipe) address: string,
    @Query('from', new DefaultValuePipe(0), ParseIntPipe) from: number,
    @Query('size', new DefaultValuePipe(25), ParseIntPipe) size: number,
  ): Promise<AccountHistory[]> {
    return this.accountService.getAccountHistory(address, new QueryPagination({ from, size }));
  }

  @Get("/accounts/:address/history/:tokenIdentifier")
  @ApiOperation({ summary: 'Account token history', description: 'Returns account token balance history' })
  @ApiQuery({ name: 'from', description: 'Number of items to skip for the result set', required: false })
  @ApiQuery({ name: 'size', description: 'Number of items to retrieve', required: false })
  @ApiOkResponse({ type: [AccountEsdtHistory] })
  async getAccountTokenHistory(
    @Param('address', ParseAddressPipe) address: string,
    @Param('tokenIdentifier', ParseTokenOrNftPipe) tokenIdentifier: string,
    @Query('from', new DefaultValuePipe(0), ParseIntPipe) from: number,
    @Query('size', new DefaultValuePipe(25), ParseIntPipe) size: number,
  ): Promise<AccountEsdtHistory[]> {
    const isToken = await this.tokenService.isToken(tokenIdentifier);
    if (!isToken) {
      throw new NotFoundException(`Token '${tokenIdentifier}' not found`);
    }

    return await this.accountService.getAccountTokenHistory(address, tokenIdentifier, new QueryPagination({ from, size }));
  }
}
