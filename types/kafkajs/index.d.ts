export type IHeaders = Record<string, Buffer | null | undefined>;

export type KafkaMessage = {
  key: Buffer | null;
  value: Buffer | null;
  headers?: IHeaders;
  timestamp: string;
};

export type EachMessagePayload = {
  topic: string;
  partition: number;
  message: KafkaMessage;
};

export interface Consumer {
  connect(): Promise<void>;
  subscribe(options: { topic: string; fromBeginning?: boolean }): Promise<void>;
  run(options: { eachMessage: (payload: EachMessagePayload) => Promise<void> }): Promise<void>;
  stop(): Promise<void>;
  disconnect(): Promise<void>;
}

export enum CompressionTypes {
  None = 0,
  GZIP = 1,
  Snappy = 2,
  LZ4 = 3,
  ZSTD = 4
}

export interface ProducerRecord {
  topic: string;
  acks?: number;
  timeout?: number;
  compression?: CompressionTypes;
  messages: {
    key?: string | Buffer | null;
    value: string | Buffer | null;
    headers?: IHeaders;
    timestamp?: number | string | Date;
    partition?: number;
  }[];
}

export interface Producer {
  connect(): Promise<void>;
  send(record: ProducerRecord): Promise<void>;
  disconnect(): Promise<void>;
}

export type KafkaConfig = {
  clientId: string;
  brokers: string[];
  logLevel?: number;
  requestTimeout?: number;
  connectionTimeout?: number;
};

export class Kafka {
  constructor(config: KafkaConfig);
  consumer(options: { groupId: string }): Consumer;
  producer(options?: { allowAutoTopicCreation?: boolean; idempotent?: boolean; retry?: { retries?: number } }): Producer;
}

export const logLevel: {
  NOTHING: number;
  ERROR: number;
  WARN: number;
  INFO: number;
  DEBUG: number;
};
