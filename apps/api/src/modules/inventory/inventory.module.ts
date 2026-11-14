import { Module } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { StockIssueController } from "./stock-issue.controller";
import { StockIssueService } from "./stock-issue.service";

/**
 * Inventory: catalog, rolls, the stock ledger, warehouses, transfers and stock correction (part 1,
 * ADR 0035), and issuing and cutting held stock with its cost of goods (part 2, ADR 0043).
 */
@Module({
  controllers: [InventoryController, StockIssueController],
  providers: [InventoryService, StockIssueService],
})
export class InventoryModule {}
