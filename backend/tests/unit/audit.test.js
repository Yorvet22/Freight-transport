const { createSafeAudit, AUDIT_ACTIONS } = require('../../src/domain/audit');

const ENTRY = { user: { id: 1, username: 'admin' }, action: 'create', entity: 'order', entityId: 5, details: null };

describe('createSafeAudit()', () => {
  it('forwards entries to the platform audit', async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    await createSafeAudit(audit).record(ENTRY);
    expect(audit.record).toHaveBeenCalledWith(ENTRY);
  });

  it('logs failures (sync throw or rejection) and never rejects', async () => {
    const logger = { error: jest.fn() };
    await expect(createSafeAudit({ record: jest.fn().mockRejectedValue(new Error('db down')) }, logger).record(ENTRY))
      .resolves.toBeUndefined();
    await expect(createSafeAudit({ record: () => { throw new Error('bad'); } }, logger).record(ENTRY))
      .resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when the platform has no audit', async () => {
    await expect(createSafeAudit(undefined).record(ENTRY)).resolves.toBeUndefined();
    await expect(createSafeAudit().record(ENTRY)).resolves.toBeUndefined();
  });

  it('exposes the action names', () => {
    expect(AUDIT_ACTIONS).toEqual({ CREATE: 'create', UPDATE: 'update', DELETE: 'delete', STATUS_CHANGE: 'status_change' });
  });
});
