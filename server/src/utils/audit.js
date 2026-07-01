import { query } from '../db.js';

export async function audit(req, { action, entityType = null, entityId = null, metadata = {} }) {
  try {
    await query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata, ip_address, user_agent, request_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [
        req.user?.id || null,
        action,
        entityType,
        entityId === null || entityId === undefined ? null : String(entityId),
        JSON.stringify(metadata || {}),
        req.ip || null,
        req.headers['user-agent'] || null,
        req.id || null
      ]
    );
  } catch (error) {
    console.error({ requestId: req.id, auditError: error.message });
  }
}
