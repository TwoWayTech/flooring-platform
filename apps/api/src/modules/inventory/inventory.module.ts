import { Module } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { LocationsService } from "./locations.service";
import { StockIssueController } from "./stock-issue.controller";
import { StockIssueService } from "./stock-issue.service";

/**
 * Inventory: catalog, rolls, the stock ledger, warehouses, transfers and stock correction (part 1,
 * ADR 0035), issuing and cutting held stock with its cost of goods (part 2, ADR 0043), and adding
 * and changing warehouses and showrooms (Settings part 4a, ADR 0059).
 */
@Module({
  controllers: [InventoryController, StockIssueController],
  providers: [InventoryService, StockIssueService, LocationsService],
})
export class InventoryModule {}
