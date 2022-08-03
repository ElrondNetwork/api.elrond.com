import { registerEnumType } from "@nestjs/graphql";

export enum EsdtDataSource {
  gateway = 'gateway',
  elastic = 'elastic'
}

registerEnumType(EsdtDataSource, {
  name: 'EsdtDataSource',
  description: 'ESDT data source.',
  valuesMap: {
    gateway: {
      description: 'Gateway data source.',
    },
    elastic: {
      description: 'Elastic data source.',
    },
  },
});
