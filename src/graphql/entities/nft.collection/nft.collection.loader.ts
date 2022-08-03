import { Injectable, Scope } from "@nestjs/common";

import DataLoader from "dataloader";

import { Account } from "src/endpoints/accounts/entities/account";
import { AccountService } from "src/endpoints/accounts/account.service";

@Injectable({
  scope: Scope.REQUEST,
})
export class NftCollectionLoader {
  constructor(private readonly accountService: AccountService) {}

  public async getAccount(address: string): Promise<Array<Account>> {
    return await this.accountDataLoader.load(address);
  }

  private readonly accountDataLoader: any = new DataLoader(async addresses => {
    // @ts-ignore
    const accounts = await this.accountService.getAccountsForAddresses(addresses);

    return accounts.sorted((element) => addresses.indexOf(element.address));
  });
}
