/**
 * Audit-hub Kafka consumer.
 *
 * Subscribes to all three Brainwave domain event topics, deserialises each
 * DomainEvent, and persists it to audit.audit_events via Prisma.
 *
 * Idempotency: uses eventId as UNIQUE constraint — duplicate messages are
 * silently skipped (P2002 Prisma unique violation → log + continue).
 *
 * Ordering note: we don't guarantee strict event ordering across topics, which
 * is fine for audit — we use occurredAt (server time set by the emitting service)
 * for display ordering, not Kafka offset.
 */

import { Kafka, type Consumer, type EachMessagePayload } from 'kafkajs';
import { KAFKA_TOPICS, CONSUMER_GROUPS, type DomainEvent } from '@brainwave-project/core';
import { prisma } from '../adapters/db/prisma/client.js';
import { logger } from '../observability/logger.js';
import { kafkaEventsConsumed, kafkaEventsErrored } from '../observability/metrics.js';
import { env } from '../config/env.js';

let consumer: Consumer | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseEvent(value: Buffer | null): DomainEvent | null {
  if (!value) return null;
  try {
    return JSON.parse(value.toString('utf8')) as DomainEvent;
  } catch {
    return null;
  }
}

async function persistEvent(topic: string, event: DomainEvent): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        eventId:      event.eventId,
        occurredAt:   new Date(event.occurredAt),
        actorId:      event.actor.userId,
        actorEmail:   event.actor.email ?? null,
        actorRoles:   event.actor.roles ?? [],
        action:       event.action,
        service:      event.service,
        resourceType: event.resource?.type  ?? null,
        resourceId:   event.resource?.id    ?? null,
        resourceName: event.resource?.name  ?? null,
        outcome:      event.outcome,
        correlationId: event.correlationId  ?? null,
        metadata:     event.metadata        ?? undefined,
      },
    });

    kafkaEventsConsumed.inc({ topic, action: event.action, outcome: event.outcome });

    logger.debug({
      eventId: event.eventId,
      action:  event.action,
      service: event.service,
    }, 'Audit event persisted');

  } catch (err: unknown) {
    // Unique violation → duplicate message; silently skip
    if (
      typeof err === 'object' && err !== null &&
      'code' in err && (err as { code: string }).code === 'P2002'
    ) {
      logger.debug({ eventId: event.eventId }, 'Duplicate audit event skipped');
      return;
    }
    kafkaEventsErrored.inc({ topic });
    logger.error({ err, eventId: event.eventId }, 'Failed to persist audit event');
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function startAuditConsumer(): Promise<void> {
  const kafka = new Kafka({
    clientId: 'audit-hub',
    brokers:  env.KAFKA_BROKERS.split(','),
    retry: {
      initialRetryTime: 300,
      retries:          10,
    },
  });

  consumer = kafka.consumer({ groupId: CONSUMER_GROUPS.AUDIT_HUB });

  await consumer.connect();
  logger.info('[kafka] Audit consumer connected');

  await consumer.subscribe({
    topics: [
      KAFKA_TOPICS.AUTH,
      KAFKA_TOPICS.USER,
      KAFKA_TOPICS.DOCUMENT,
    ],
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ topic, message }: EachMessagePayload) => {
      const event = parseEvent(message.value);
      if (!event) {
        logger.warn({ topic }, 'Received unparseable message — skipping');
        return;
      }
      await persistEvent(topic, event);
    },
  });

  logger.info('[kafka] Audit consumer running — subscribed to all domain event topics');
}

export async function stopAuditConsumer(): Promise<void> {
  await consumer?.disconnect();
  logger.info('[kafka] Audit consumer disconnected');
}
