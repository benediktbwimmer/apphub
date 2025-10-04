#!/usr/bin/env node
import { Kafka } from 'kafkajs';
import process from 'node:process';

interface SampleEvent {
  user_id: string;
  amount: number;
  ts: string;
}

async function main(): Promise<void> {
  const broker = process.env.APPHUB_STREAM_BROKER_URL ?? '127.0.0.1:19092';
  const topic = process.env.APPHUB_STREAM_INPUT_TOPIC ?? 'apphub.streaming.input';
  const userCount = Number.parseInt(process.env.APPHUB_STREAM_SAMPLE_USERS ?? '3', 10) || 3;
  const eventsPerUser = Number.parseInt(process.env.APPHUB_STREAM_SAMPLE_EVENTS ?? '5', 10) || 5;

  const kafka = new Kafka({ clientId: 'apphub-streaming-sample', brokers: [broker] });
  const producer = kafka.producer();

  await producer.connect();
  const messages: { key: string; value: string }[] = [];
  const now = Date.now();

  for (let userIdx = 0; userIdx < userCount; userIdx += 1) {
    const userId = `user-${userIdx + 1}`;
    for (let eventIdx = 0; eventIdx < eventsPerUser; eventIdx += 1) {
      const amount = Number((Math.random() * 50 + 10).toFixed(2));
      const ts = new Date(now - eventIdx * 10_000).toISOString();
      const payload: SampleEvent = { user_id: userId, amount, ts };
      messages.push({ key: userId, value: JSON.stringify(payload) });
    }
  }

  await producer.send({ topic, messages });
  await producer.disconnect();

  console.info('[streaming] Seeded sample events', { broker, topic, messageCount: messages.length });
}

main().catch((err) => {
  console.error('[streaming] Failed to seed sample data:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
