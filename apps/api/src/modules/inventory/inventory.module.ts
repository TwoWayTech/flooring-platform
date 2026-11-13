import { Module } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";

/** Inventory, part 1: catalog, rolls, the stock ledger, warehouses, transfers and stock correction (ADR 0035). */
@Module({ controllers: [InventoryController], providers: [InventoryService] })
export class InventoryModule {}
