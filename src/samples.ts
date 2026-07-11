export const SAMPLE_ECOMMERCE = `-- Sample: e-commerce schema without explicit foreign keys
CREATE TABLE users (
  id BIGINT NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL COMMENT 'Login identifier, must be unique',
  name VARCHAR(120) COMMENT 'Display name',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_email (email)
) ENGINE=InnoDB COMMENT='Registered application users';

CREATE TABLE addresses (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL COMMENT 'Owner',
  line1 VARCHAR(200) NOT NULL,
  city VARCHAR(80),
  country CHAR(2),
  PRIMARY KEY (id),
  KEY idx_user (user_id)
) COMMENT='Shipping / billing addresses per user';

CREATE TABLE products (
  id BIGINT NOT NULL AUTO_INCREMENT,
  sku VARCHAR(64) NOT NULL COMMENT 'Stock-keeping unit',
  name VARCHAR(200) NOT NULL,
  category_id BIGINT,
  price_cents INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_category (category_id)
) COMMENT='Sellable items in the catalog';

CREATE TABLE categories (
  id BIGINT NOT NULL AUTO_INCREMENT,
  name VARCHAR(80) NOT NULL,
  parent_id BIGINT,
  PRIMARY KEY (id)
);

CREATE TABLE orders (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL COMMENT 'Buyer',
  shipping_address_id BIGINT COMMENT 'Where to ship; null = digital order',
  out_trade_no VARCHAR(64) COMMENT 'External trade number shared with the payment service (no physical FK)',
  status VARCHAR(32) NOT NULL COMMENT 'pending / paid / shipped / refunded',
  total_cents INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user (user_id),
  KEY idx_status (status)
) COMMENT='Customer orders';

CREATE TABLE order_items (
  id BIGINT NOT NULL AUTO_INCREMENT,
  order_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  quantity INT NOT NULL,
  unit_price_cents INT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_order (order_id),
  KEY idx_product (product_id)
);

CREATE TABLE payments (
  id BIGINT NOT NULL AUTO_INCREMENT,
  order_id BIGINT NOT NULL,
  out_trade_no VARCHAR(64) COMMENT 'External trade number — the sharded services join on this business key',
  amount_cents INT NOT NULL,
  method VARCHAR(32),
  paid_at DATETIME,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_order (order_id),
  UNIQUE KEY uniq_out_trade_no (out_trade_no)
);

CREATE TABLE payment_refunds (
  id BIGINT NOT NULL AUTO_INCREMENT,
  payment_id BIGINT NOT NULL,
  order_ref BIGINT COMMENT 'Originating order — named with the _ref suffix instead of _id',
  out_trade_no VARCHAR(64) COMMENT 'External trade number of the refunded payment',
  amount_cents INT NOT NULL,
  reason VARCHAR(200),
  refunded_at DATETIME,
  PRIMARY KEY (id),
  KEY idx_payment (payment_id)
) COMMENT='Per-payment refund ledger';

CREATE TABLE inventory_items (
  id BIGINT NOT NULL AUTO_INCREMENT,
  product_id BIGINT NOT NULL,
  warehouse_id BIGINT NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_product (product_id),
  KEY idx_warehouse (warehouse_id)
) COMMENT='Per-warehouse stock for each product';

CREATE TABLE inventory_warehouses (
  id BIGINT NOT NULL AUTO_INCREMENT,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(120),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_code (code)
);

CREATE TABLE marketing_campaigns (
  id BIGINT NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  starts_at DATETIME,
  ends_at DATETIME,
  PRIMARY KEY (id)
) COMMENT='Promotional campaigns';

CREATE TABLE marketing_coupons (
  id BIGINT NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT NOT NULL,
  code VARCHAR(40) NOT NULL,
  discount_cents INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_code (code),
  KEY idx_campaign (campaign_id)
);

CREATE TABLE crm_tickets (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  order_id BIGINT,
  subject VARCHAR(200) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user (user_id),
  KEY idx_order (order_id)
) COMMENT='Customer-support tickets';

-- Sharded by month, WITH a suffix-less base table (the PG-parent / MySQL
-- hot-table pattern). Pipeline should detect the _YYYYMM suffix, absorb the
-- base, and collapse all five into a single node named account_detail.
CREATE TABLE account_detail (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL COMMENT 'Account owner',
  balance_cents BIGINT NOT NULL DEFAULT 0,
  recorded_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_user (user_id)
) COMMENT='Monthly account balance snapshots';

CREATE TABLE account_detail_202401 (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL COMMENT 'Account owner',
  balance_cents BIGINT NOT NULL DEFAULT 0,
  recorded_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_user (user_id)
) COMMENT='Monthly account balance snapshots';

CREATE TABLE account_detail_202402 (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  balance_cents BIGINT NOT NULL DEFAULT 0,
  recorded_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_user (user_id)
);

CREATE TABLE account_detail_202403 (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  balance_cents BIGINT NOT NULL DEFAULT 0,
  recorded_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_user (user_id)
);

CREATE TABLE account_detail_202404 (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  balance_cents BIGINT NOT NULL DEFAULT 0,
  recorded_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_user (user_id)
);
`;

export const SAMPLE_BLOG = `-- Sample: blog schema with explicit FK on author_id
CREATE TABLE \`t_user\` (
  id BIGINT PRIMARY KEY,
  username VARCHAR(60) NOT NULL,
  email VARCHAR(120)
);

CREATE TABLE \`t_post\` (
  id BIGINT PRIMARY KEY,
  author_id BIGINT NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_post_author FOREIGN KEY (author_id) REFERENCES t_user(id)
);

CREATE TABLE \`t_comment\` (
  id BIGINT PRIMARY KEY,
  post_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  parent_comment_id BIGINT,
  body TEXT
);

CREATE TABLE \`t_tag\` (
  id BIGINT PRIMARY KEY,
  name VARCHAR(40)
);

CREATE TABLE \`t_post_tag\` (
  post_id BIGINT NOT NULL,
  tag_id BIGINT NOT NULL,
  PRIMARY KEY (post_id, tag_id)
);
`;
