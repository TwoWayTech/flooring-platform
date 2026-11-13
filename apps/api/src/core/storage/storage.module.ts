import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { storageFor, type StorageProvider } from "@workspace/providers";
import type { ApiEnv } from "../config/env";

/** Injection token for the StorageProvider chosen by STORAGE_PROVIDER (memory locally, S3 or R2 in production). */
export const STORAGE = Symbol("STORAGE");

/** File storage through packages/providers only (CLAUDE.md rule 11). */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnv, true>): StorageProvider =>
        storageFor(config.get("providers", { infer: true }).storage),
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}
