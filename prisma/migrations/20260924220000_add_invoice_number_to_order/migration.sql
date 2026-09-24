ALTER TABLE `orders`
  ADD COLUMN `invoiceNumber` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `orders_invoiceNumber_key` (`invoiceNumber`),
  ADD INDEX `orders_invoiceNumber_idx` (`invoiceNumber`);
