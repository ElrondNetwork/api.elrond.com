import { Logger } from "@nestjs/common";
import { PerformanceProfiler } from "./performance.profiler";

const bech32 = require('bech32');
const { readdirSync } = require('fs')
const BigNumber = require('bignumber.js');

export function mergeObjects(obj1: any, obj2: any) {
  for (const key of Object.keys(obj2)) {
      if (key in obj1) {
          obj1[key] = obj2[key];
      }
  }

  return obj1;
}

export function roundToEpoch(round: number): number {
  return Math.floor(round / 14401);
}

export function bech32Encode(publicKey: string) {
  const words = bech32.toWords(Buffer.from(publicKey, 'hex'));
  return bech32.encode('erd', words);
};

export function bech32Decode(address: string) {
  const decoded = bech32.decode(address, 256);
  return Buffer.from(bech32.fromWords(decoded.words)).toString('hex');
};

export function base64Encode(str: string) {
  return Buffer.from(str).toString('base64');
};

export function base64Decode(str: string): string {
  return base64DecodeBinary(str).toString('binary');
}

export function base64DecodeBinary(str: string): Buffer {
  return Buffer.from(str, 'base64');
};

export function padHex(value: string): string {
  return (value.length % 2 ? '0' + value : value);
}

export function computeShard(hexPubKey: string) {
  let numShards = 3;
  let maskHigh = parseInt('11', 2);
  let maskLow = parseInt('01', 2);
  let pubKey = Buffer.from(hexPubKey, 'hex');
  let lastByteOfPubKey = pubKey[31];

  if (isAddressOfMetachain(pubKey)) {
    return 4294967295;
  }

  let shard = lastByteOfPubKey & maskHigh;

  if (shard > numShards - 1) {
    shard = lastByteOfPubKey & maskLow;
  }

  return shard;
};

function isAddressOfMetachain(pubKey: Buffer) {
  // prettier-ignore
  let metachainPrefix = Buffer.from([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    ]);
  let pubKeyPrefix = pubKey.slice(0, metachainPrefix.length);

  if (pubKeyPrefix.equals(metachainPrefix)) {
    return true;
  }

  let zeroAddress = Buffer.alloc(32).fill(0);

  if (pubKey.equals(zeroAddress)) {
    return true;
  }

  return false;
};

export function isSmartContractAddress(address: string): boolean {
  return address.includes('qqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqq');
}

export function denominate(value: BigInt): number {
  return Number(value.valueOf() / BigInt(Math.pow(10, 18)));
}

export function denominateString(value: string): number {
  return denominate(BigInt(value));
}

export function hexToString(hex: string): string {
  var str = '';
  for (var n = 0; n < hex.length; n += 2) {
    str += String.fromCharCode(parseInt(hex.substr(n, 2), 16));
  }
  
  return str;
}

export function numberDecode(encoded: string) {
  const hex = Buffer.from(encoded, 'base64').toString('hex');
  return BigNumber(hex, 16).toString(10);
};

export function cleanupApiValueRecursively(obj: any) {
  if (Array.isArray(obj)) {
    for (let item of obj) {
      if (item && typeof item === 'object') {
        cleanupApiValueRecursively(item);
      }
    }
  } else if (obj && typeof obj === 'object') {
    for (let [key, value] of Object.entries(obj)) {
      if (typeof value === 'object') {
        cleanupApiValueRecursively(value);
      }

      if (Array.isArray(value)) {
        for (let item of value) {
          if (item && typeof item === 'object') {
            cleanupApiValueRecursively(item);
          }
        }
      }

      if (value === null || value === '' || value === undefined) {
        delete obj[key];
      }

      //TODO: think about whether this is applicable everywhere
      if (Array.isArray(value) && value.length === 0) {
        delete obj[key];
      }
    }
  }

  return obj
}

Date.prototype.isToday = function(): boolean {
  return this.toISODateString() === new Date().toISODateString();
};

Date.prototype.toISODateString = function(): string {
  return this.toISOString().slice(0, 10);
};

Number.prototype.toRounded = function(digits: number): number {
  return parseFloat(this.toFixed(digits));
};

declare global {
  interface Number {
    toRounded(digits: number): number;
  }

  interface Date {
    toISODateString(): string;
    isToday(): boolean;
  }

  interface Array<T> {
    groupBy(predicate: (item: T) => any): any;
    selectMany(predicate: (item: T) => T[]): T[];
    firstOrUndefined(predicate: (item: T) => boolean): T | undefined;
    zip<TSecond, TResult>(second: TSecond[], predicate: (first: T, second: TSecond) => TResult): TResult[];
    remove(element: T): number;
  }
}

Array.prototype.groupBy = function(predicate: Function, asArray = false) {
  let result = this.reduce(function(rv, x) {
      (rv[predicate(x)] = rv[predicate(x)] || []).push(x);
      return rv;
  }, {});

  if (asArray === true) {
      result = Object.keys(result).map(key => {
          return {
              key: key,
              values: result[key]
          };
      });
  }

  return result;
};

Array.prototype.selectMany = function(predicate: Function) {
  let result = [];

  for (let item of this) {
      result.push(...predicate(item));
  }

  return result;
};

Array.prototype.firstOrUndefined = function(predicate: Function) {
  let result = this.filter(x => predicate(x));

  if (result.length > 0) {
    return result[0];
  }

  return undefined;
};

Array.prototype.zip = function<TSecond, TResult>(second: TSecond[], predicate: Function): TResult[] {
  return this.map((element: any, index: number) => predicate(element, second[index]));
};

Array.prototype.remove = function<T>(element: T): number {
  let index = this.indexOf(element);
  if (index >= 0) {
    this.splice(index, 1);
  }

  return index;
}

export function getDirectories(source: string) {
  return readdirSync(source, { withFileTypes: true })
    .filter((dirent: any) => dirent.isDirectory())
    .map((dirent: any) => dirent.name);
}

let lockArray: string[] = [];

export async function lock(key: string, func: () => Promise<void>, log: boolean = false) {
  let logger = new Logger('Lock');

  if (lockArray.includes(key)) {
    logger.log(`${key} is already running`);
    return;
  }

  lockArray.push(key);

  let profiler = new PerformanceProfiler();

  try {
    await func();
  } catch (error) {
    logger.error(`Error running ${key}`);
    logger.error(error);
  } finally {
    profiler.stop(`Running ${key}`, log);
    lockArray.remove(key);
  }
}