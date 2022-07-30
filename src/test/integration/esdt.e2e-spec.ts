import { EsdtAddressService } from 'src/endpoints/esdt/esdt.address.service';
import { Test } from "@nestjs/testing";
import { EsdtService } from "../../endpoints/esdt/esdt.service";
import { PublicAppModule } from "src/public.app.module";
import { EsdtSupply } from "src/endpoints/esdt/entities/esdt.supply";
import { NftFilter } from "src/endpoints/nfts/entities/nft.filter";
import { NftType } from "src/endpoints/nfts/entities/nft.type";
import { EsdtDataSource } from 'src/endpoints/esdt/entities/esdt.data.source';
import '@elrondnetwork/erdnest/lib/utils/extensions/jest.extensions';
import { TokenRoles } from 'src/endpoints/tokens/entities/token.roles';
import { CachingService } from '@elrondnetwork/erdnest';

describe('ESDT Service', () => {
  let esdtService: EsdtService;
  let esdtAddressService: EsdtAddressService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PublicAppModule],
    }).compile();

    esdtService = moduleRef.get<EsdtService>(EsdtService);
    esdtAddressService = moduleRef.get<EsdtAddressService>(EsdtAddressService);

  });

  describe("Get ESDT For Address", () => {
    it("should return esdts of type MetaESDT", async () => {
      const address: string = "erd1k3wtee6vzk47halxwm7qud3mrdjrlw4fyjvuhamtzy4hjhe6htcsv9jcgs";
      const filter = new NftFilter();
      filter.type = NftType.MetaESDT;
      const results = await esdtAddressService.getNftsForAddress(address, filter, { from: 0, size: 2 });

      expect(results).toHaveLength(2);

      for (const result of results) {
        expect(result.type).toStrictEqual("MetaESDT");
      }
    });

    it("should return esdts of type SemiFungibleESDT", async () => {
      const address: string = "erd1k3wtee6vzk47halxwm7qud3mrdjrlw4fyjvuhamtzy4hjhe6htcsv9jcgs";
      const filter = new NftFilter();
      filter.type = NftType.SemiFungibleESDT;

      const results = await esdtAddressService.getNftsForAddress(address, filter, { from: 0, size: 2 });

      expect(results).toHaveLength(2);

      for (const result of results) {
        expect(result.type).toStrictEqual("SemiFungibleESDT");
      }
    });

    it("should return esdts of type NonFungibleESDT", async () => {
      const address: string = "erd1k3wtee6vzk47halxwm7qud3mrdjrlw4fyjvuhamtzy4hjhe6htcsv9jcgs";
      const filter = new NftFilter();
      filter.type = NftType.NonFungibleESDT;

      const results = await esdtAddressService.getNftsForAddress(address, filter, { from: 0, size: 2 });

      expect(results).toHaveLength(2);

      for (const result of results) {
        expect(result.type).toStrictEqual("NonFungibleESDT");
      }
    });

    it("should return esdts of type NonFungibleESDT and SemiFungibleESDT", async () => {
      const address: string = "erd1k3wtee6vzk47halxwm7qud3mrdjrlw4fyjvuhamtzy4hjhe6htcsv9jcgs";
      const resultNft = await esdtAddressService.getNftsForAddress(address, { type: NftType.NonFungibleESDT }, { from: 0, size: 100 });
      const resultSft = await esdtAddressService.getNftsForAddress(address, { type: NftType.SemiFungibleESDT }, { from: 0, size: 100 });

      for (const result of resultNft) {
        expect(result.type).toStrictEqual("NonFungibleESDT");
      }

      for (const result of resultSft) {
        expect(result.type).toStrictEqual("SemiFungibleESDT");
      }
    });

    it('gateway & elastic esdts of address should be the same', async () => {
      const esdtAddress: string = 'erd1qqqqqqqqqqqqqpgqhe8t5jewej70zupmh44jurgn29psua5l2jps3ntjj3';
      const gatewayNfts = await esdtAddressService.getNftsForAddress(esdtAddress, new NftFilter(), { from: 0, size: 25 }, EsdtDataSource.gateway);
      const elasticNfts = await esdtAddressService.getNftsForAddress(esdtAddress, new NftFilter(), { from: 0, size: 25 }, EsdtDataSource.elastic);

      const sortedGatewayNfts = gatewayNfts.sort((a, b) => a.identifier.localeCompare(b.identifier));
      const sortedElasticNfts = elasticNfts.sort((a, b) => a.identifier.localeCompare(b.identifier));

      expect(sortedGatewayNfts).toStrictEqual(sortedElasticNfts);
    });
  });

  describe("Get ESDT Tokens Properties", () => {
    it("should return all ESDT tokens", async () => {
      const results = await esdtService.getAllEsdtAndMetaEsdtTokens();

      for (const result of results) {
        expect(result.hasOwnProperty("identifier")).toBeTruthy();
        expect(result.hasOwnProperty("name")).toBeTruthy();
        expect(result.hasOwnProperty("ticker")).toBeTruthy();
        expect(result.hasOwnProperty("owner")).toBeTruthy();
        expect(result.hasOwnProperty("isPaused")).toBeTruthy();
        expect(result.hasOwnProperty("canUpgrade")).toBeTruthy();
        expect(result.hasOwnProperty("canMint")).toBeTruthy();
        expect(result.hasOwnProperty("canBurn")).toBeTruthy();
        expect(result.hasOwnProperty("canChangeOwner")).toBeTruthy();
        expect(result.hasOwnProperty("canPause")).toBeTruthy();
        expect(result.hasOwnProperty("canFreeze")).toBeTruthy();
        expect(result.hasOwnProperty("canWipe")).toBeTruthy();
      }
    });
  });

  describe("Get ESDT Token Properties", () => {
    it("should return the properties of the token ( ticker property should not be present )", async () => {
      jest
        .spyOn(CachingService.prototype, 'getOrSetCache')
        // eslint-disable-next-line require-await
        .mockImplementation(jest.fn(async (_key: string, promise: any) => promise()));

      const tokenIdentifier: string = "EGLDMEX-0be9e5";
      const results = await esdtService.getEsdtTokenProperties(tokenIdentifier);

      if (!results) {
        throw new Error("Properties are not defined");
      }

      expect(results.hasOwnProperty("identifier")).toBeTruthy();
      expect(results.hasOwnProperty("name")).toBeTruthy();
      expect(results.hasOwnProperty("owner")).toBeTruthy();
      expect(results.hasOwnProperty("isPaused")).toBeTruthy();
      expect(results.hasOwnProperty("canUpgrade")).toBeTruthy();
      expect(results.hasOwnProperty("canMint")).toBeTruthy();
      expect(results.hasOwnProperty("canBurn")).toBeTruthy();
      expect(results.hasOwnProperty("canChangeOwner")).toBeTruthy();
      expect(results.hasOwnProperty("canPause")).toBeTruthy();
      expect(results.hasOwnProperty("canFreeze")).toBeTruthy();
      expect(results.hasOwnProperty("canWipe")).toBeTruthy();
    });
  });

  describe('Get Esdt Addresses Roles', () => {
    it('return addresses role', async () => {
      const tokenIdentifier: string = "EGLDMEX-0be9e5";
      const results = await esdtService.getEsdtAddressesRoles(tokenIdentifier);

      if (!results) {
        throw new Error('Roles properties must be defined');
      }

      for (const result of results) {
        expect(result).toHaveStructure(Object.keys(new TokenRoles()));
      }
    });
  });

  describe('Get Esdt Addresses Roles Raw', () => {
    it('EGLDMEX token should have valid roles', async () => {
      const tokenIdentifier: string = "EGLDMEX-0be9e5";
      const results = await esdtService.getEsdtAddressesRolesRaw(tokenIdentifier);

      if (!results) {
        throw new Error('Properties are not defined');
      }

      for (const result of results) {
        expect(result).toHaveStructure(Object.keys(new TokenRoles()));
      }
    });
  });

  describe('Get Token Supply', () => {
    it('should return esdt token supply', async () => {
      const tokenIdentifier: string = "EGLDMEX-0be9e5";
      const results = await esdtService.getTokenSupply(tokenIdentifier);

      if (!results) {
        throw new Error('Properties are not defined');
      }
      expect(results).toHaveStructure(Object.keys(new EsdtSupply()));
    });
  });

  describe('Get Token Account Count', () => {
    it('return token account count', async () => {
      const tokenIdentifier: string = "EGLDMEX-0be9e5";
      const result = await esdtService.getEsdtAccountsCount(tokenIdentifier);

      expect(typeof result).toStrictEqual('number');
    });
  });
});
