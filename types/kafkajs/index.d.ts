export type KafkaMessage = {
  key: Buffer | null;
  value: Buffer | null;
  headers?: Record<string, Buffer | undefined>;
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

export interface ProducerRecord {
  topic: string;
  messages: { key?: string | Buffer | null; value: string | Buffer | null }[];
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
};

export class Kafka {
  constructor(config: KafkaConfig);
  consumer(options: { groupId: string }): Consumer;
  producer(): Producer;
}

export const logLevel: {
  NOTHING: number;
  ERROR: number;
  WARN: number;
  INFO: number;
  DEBUG: number;
};
