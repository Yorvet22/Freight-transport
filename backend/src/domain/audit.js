// Audit trail adapter (SPEC §11). Wraps the platform audit so that an audit failure is logged
// but never fails the request; a missing platform audit is a no-op.
const AUDIT_ACTIONS = Object.freeze({
  CREATE:        'create',
  UPDATE:        'update',
  DELETE:        'delete',
  STATUS_CHANGE: 'status_change',
});

const NOOP_AUDIT = Object.freeze({ record: async () => {} });

function createSafeAudit(audit, logger = console) {
  if (!audit || typeof audit.record !== 'function') return NOOP_AUDIT;
  return {
    async record(entry) {
      try {
        await audit.record(entry);
      } catch (err) {
        logger.error(`Audit record failed (${entry.action} ${entry.entity} #${entry.entityId}):`, err);
      }
    },
  };
}

module.exports = { createSafeAudit, AUDIT_ACTIONS, NOOP_AUDIT };
