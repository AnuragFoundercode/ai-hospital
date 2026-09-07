-- Blood bank inventory: 1 bag = 1 row (1 unit). Add per-bag price.

ALTER TABLE bloodbank_inventory_items
  ADD COLUMN IF NOT EXISTS price_per_unit DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER units;

-- 1 bag = 1 unit going forward. Normalize any legacy multi-unit rows to 1.
UPDATE bloodbank_inventory_items SET units = 1 WHERE units <> 1;
