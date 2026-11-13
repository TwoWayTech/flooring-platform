import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { BrandingController } from "./branding.controller";

/** Public branding by host for the login page (P8 part 2). */
@Module({ imports: [AuthModule], controllers: [BrandingController] })
export class BrandingModule {}
