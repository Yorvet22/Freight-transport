-- 002: audit trail of create/update/delete/status changes (SPEC §11).
-- userId has no FK on purpose: audit rows must outlive deleted users.
CREATE TABLE audit_log (
  id        INT         NOT NULL AUTO_INCREMENT,
  userId    INT         NULL,
  username  VARCHAR(50) NOT NULL,
  action    VARCHAR(20) NOT NULL,
  entity    VARCHAR(30) NOT NULL,
  entityId  INT         NOT NULL,
  details   JSON        NULL,
  createdAt DATETIME    NOT NULL,
  PRIMARY KEY (id),
  INDEX idx_audit_entity (entity, entityId),
  INDEX idx_audit_createdAt (createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
