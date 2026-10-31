-- 001: initial FreightFlow schema (SPEC §2). Applied by backend/src/db/migrate.js into DB_NAME.
-- Column names are camelCase and equal the JSON field names. All DATETIME values are UTC.

CREATE TABLE warehouses (
  id              INT          NOT NULL AUTO_INCREMENT,
  code            VARCHAR(20)  NOT NULL,
  name            VARCHAR(100) NOT NULL,
  address         VARCHAR(200) NOT NULL,
  city            VARCHAR(100) NOT NULL,
  capacityPallets INT          NULL,
  managerName     VARCHAR(100) NULL,
  phone           VARCHAR(30)  NULL,
  isActive        BOOLEAN      NOT NULL DEFAULT TRUE,
  createdAt       DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_warehouses_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE vehicles (
  id           INT          NOT NULL AUTO_INCREMENT,
  model        VARCHAR(100) NOT NULL,
  licensePlate VARCHAR(20)  NOT NULL,
  driverName   VARCHAR(100) NOT NULL,
  capacityKg   INT          NULL,
  status       VARCHAR(20)  NOT NULL DEFAULT 'available',
  PRIMARY KEY (id),
  UNIQUE KEY uq_vehicles_licensePlate (licensePlate),
  INDEX idx_vehicles_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- orderNumber is NULL only for the instant between INSERT and the follow-up UPDATE
-- that sets it to 'ORD-' + LPAD(id, 6, '0') in the same transaction.
CREATE TABLE orders (
  id                     INT            NOT NULL AUTO_INCREMENT,
  orderNumber            VARCHAR(20)    NULL,
  type                   VARCHAR(20)    NOT NULL,
  clientName             VARCHAR(100)   NOT NULL,
  pickupAddress          VARCHAR(200)   NOT NULL,
  deliveryAddress        VARCHAR(200)   NOT NULL,
  cargoDescription       TEXT           NOT NULL,
  cargoWeight            DECIMAL(10, 2) NOT NULL,
  status                 VARCHAR(20)    NOT NULL DEFAULT 'new',
  vehicleId              INT            NULL,
  originWarehouseId      INT            NULL,
  destinationWarehouseId INT            NULL,
  plannedDeliveryDate    DATE           NULL,
  pickupWindowStart      DATETIME       NULL,
  pickupWindowEnd        DATETIME       NULL,
  dockNumber             VARCHAR(10)    NULL,
  podRecipientName       VARCHAR(100)   NULL,
  podSignature           MEDIUMTEXT     NULL,
  podNote                VARCHAR(500)   NULL,
  createdAt              DATETIME       NOT NULL,
  deliveredAt            DATETIME       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_orderNumber (orderNumber),
  INDEX idx_orders_status (status),
  INDEX idx_orders_type (type),
  INDEX idx_orders_vehicleId (vehicleId),
  INDEX idx_orders_originWarehouseId (originWarehouseId),
  INDEX idx_orders_destinationWarehouseId (destinationWarehouseId),
  INDEX idx_orders_createdAt (createdAt),
  CONSTRAINT fk_orders_vehicle FOREIGN KEY (vehicleId)
    REFERENCES vehicles (id) ON DELETE SET NULL,
  CONSTRAINT fk_orders_origin_warehouse FOREIGN KEY (originWarehouseId)
    REFERENCES warehouses (id) ON DELETE SET NULL,
  CONSTRAINT fk_orders_destination_warehouse FOREIGN KEY (destinationWarehouseId)
    REFERENCES warehouses (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE order_status_history (
  id         INT          NOT NULL AUTO_INCREMENT,
  orderId    INT          NOT NULL,
  fromStatus VARCHAR(20)  NULL,
  toStatus   VARCHAR(20)  NOT NULL,
  changedAt  DATETIME     NOT NULL,
  changedBy  VARCHAR(50)  NULL,
  note       VARCHAR(500) NULL,
  PRIMARY KEY (id),
  INDEX idx_history_orderId (orderId),
  CONSTRAINT fk_history_order FOREIGN KEY (orderId)
    REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE users (
  id           INT          NOT NULL AUTO_INCREMENT,
  username     VARCHAR(50)  NOT NULL,
  passwordHash VARCHAR(200) NOT NULL,
  role         VARCHAR(20)  NOT NULL,
  createdAt    DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
