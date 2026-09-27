-- CreateTable
CREATE TABLE `raw_material_movements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `raw_material_item_id` INTEGER NOT NULL,
    `movement_type` ENUM('STOCK_IN', 'PRODUCTION_USE', 'SCRAP_RETURN', 'DAMAGE_WASTE', 'AUDIT_ADJUST') NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `previous_stock` DOUBLE NOT NULL,
    `new_stock` DOUBLE NOT NULL,
    `reference` TEXT NULL,
    `recorded_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `raw_material_movements_raw_material_item_id_idx`(`raw_material_item_id`),
    INDEX `raw_material_movements_movement_type_idx`(`movement_type`),
    INDEX `raw_material_movements_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supplier_payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `raw_material_shop_id` INTEGER NOT NULL,
    `buy_raw_material_id` INTEGER NULL,
    `amount` DOUBLE NOT NULL,
    `payment_method` VARCHAR(191) NOT NULL DEFAULT 'CASH',
    `reference` VARCHAR(191) NULL,
    `payment_date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `supplier_payments_raw_material_shop_id_idx`(`raw_material_shop_id`),
    INDEX `supplier_payments_buy_raw_material_id_idx`(`buy_raw_material_id`),
    INDEX `supplier_payments_payment_date_idx`(`payment_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `raw_material_movements` ADD CONSTRAINT `raw_material_movements_raw_material_item_id_fkey` FOREIGN KEY (`raw_material_item_id`) REFERENCES `raw_material_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_raw_material_shop_id_fkey` FOREIGN KEY (`raw_material_shop_id`) REFERENCES `raw_material_shops`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_buy_raw_material_id_fkey` FOREIGN KEY (`buy_raw_material_id`) REFERENCES `buy_raw_materials`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

