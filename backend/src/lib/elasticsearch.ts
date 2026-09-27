import { Client } from '@elastic/elasticsearch';
import { config } from '../config';
import { Email, EmailStatus } from '@prisma/client';

export const elasticClient = new Client({
  node: config.elasticsearch.url,
  auth: config.elasticsearch.password
    ? {
        username: config.elasticsearch.username,
        password: config.elasticsearch.password,
      }
    : undefined,
  // The @elastic/elasticsearch v8 client sends an Accept header with
  // "compatible-with=8"; we don't need to manually override it as it causes duplicate headers.
});

const indexName = config.elasticsearch.index;

export async function initElasticsearch() {
  try {
    const health = await elasticClient.cluster.health({});
    console.log('[Elasticsearch] Connected successfully. Status:', health.status);

    const indexExists = await elasticClient.indices.exists({ index: indexName });
    if (!indexExists) {
      await elasticClient.indices.create({
        index: indexName,
        mappings: {
          properties: {
            id: { type: 'keyword' },
            tenantId: { type: 'keyword' },
            senderId: { type: 'keyword' },
            toAddress: { type: 'text' },
            fromAddress: { type: 'text' },
            subject: { type: 'text' },
            body: { type: 'text' },
            status: { type: 'keyword' },
            scheduledAt: { type: 'date' },
            sentAt: { type: 'date' },
            createdAt: { type: 'date' },
            updatedAt: { type: 'date' },
          },
        },
      });
      console.log(`[Elasticsearch] Index "${indexName}" ready`);
    } else {
      console.log(`[Elasticsearch] Index "${indexName}" ready`);
    }
  } catch (error) {
    console.error('[Elasticsearch] Connection failed:', error instanceof Error ? error.message : error);
  }
}

export async function indexEmail(email: Email, senderEmail: string) {
  try {
    await elasticClient.index({
      index: indexName,
      id: email.id,
      document: {
        id: email.id,
        tenantId: email.tenantId,
        senderId: email.senderId,
        toAddress: email.toAddress,
        fromAddress: senderEmail,
        subject: email.subject,
        body: email.body,
        status: email.status,
        scheduledAt: email.scheduledAt,
        sentAt: email.sentAt,
        createdAt: email.createdAt,
        updatedAt: email.updatedAt,
      },
    });
  } catch (error) {
    console.error(`[Elasticsearch] Failed to index email ${email.id}:`, error instanceof Error ? error.message : error);
  }
}

export async function updateEmailStatus(id: string, status: EmailStatus, sentAt?: Date) {
  try {
    const doc: any = { status };
    if (sentAt) doc.sentAt = sentAt;
    
    await elasticClient.update({
      index: indexName,
      id,
      doc,
    });
  } catch (error) {
    console.error(`[Elasticsearch] Failed to update email ${id}:`, error instanceof Error ? error.message : error);
  }
}

export async function removeEmailFromIndex(id: string) {
  try {
    await elasticClient.delete({
      index: indexName,
      id,
    });
  } catch (error) {
    console.error(`[Elasticsearch] Failed to remove email ${id}:`, error instanceof Error ? error.message : error);
  }
}

export async function searchEmails(tenantId: string, query: string, page = 1, limit = 50) {
  try {
    const result = await elasticClient.search({
      index: indexName,
      from: (page - 1) * limit,
      size: limit,
      query: {
        bool: {
          must: [
            { term: { tenantId } }
          ],
          should: [
            { match: { toAddress: query } },
            { match: { fromAddress: query } },
            { match: { subject: query } },
            { match: { body: query } }
          ],
          minimum_should_match: 1
        }
      },
      sort: [
        { _score: { order: 'desc' } },
        { createdAt: { order: 'desc' } }
      ]
    });

    const hits = result.hits.hits.map((hit: any) => hit._source);
    return {
      emails: hits,
      total: typeof result.hits.total === 'number' ? result.hits.total : result.hits.total?.value || 0
    };
  } catch (error) {
    console.error('[Elasticsearch] Search failed:', error instanceof Error ? error.message : error);
    throw error;
  }
}
