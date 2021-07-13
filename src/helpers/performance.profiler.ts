// import { Logger } from "@nestjs/common";

export class PerformanceProfiler {
  started: number;
  description: string;

  stopped: number = 0;
  duration: number = 0;

  constructor(description: string = '') {
    this.started = Date.now();
    this.description = description;
  }

  stop(_: string | null = null, skipLogging: boolean = false) {
    this.stopped = Date.now();
    this.duration = this.stopped - this.started;

    if (!skipLogging) {
      // let logger = new Logger(PerformanceProfiler.name);

      // logger.verbose(`${description ?? this.description}: ${this.duration}ms`);
    }
  }
}