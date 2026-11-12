import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { SignedUrlOptions, StorageProvider, StoredObject } from "./types";

/** Settings for any S3-compatible store. */
export interface S3Options {
  bucket: string;
  region: string;
  /** Set for Cloudflare R2 (https://<account>.r2.cloudflarestorage.com); empty for AWS S3. */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Files in an S3-compatible bucket. One adapter covers Cloudflare R2 (today) and AWS S3
 * (blueprint "Provider portability"): R2 differs only by its endpoint and the region "auto".
 */
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;

  constructor(
    private readonly options: S3Options,
    client?: S3Client,
  ) {
    const config: S3ClientConfig = {
      region: options.region,
      endpoint: options.endpoint || undefined,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    };
    this.client = client ?? new S3Client(config);
  }

  /** Uploads the bytes under the key, replacing any file already there. */
  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.options.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /** Downloads the file, or null when the key is unknown. */
  async get(key: string): Promise<StoredObject | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }));
      if (!result.Body) return null;
      const body = await result.Body.transformToByteArray();
      return { body, contentType: result.ContentType ?? "application/octet-stream" };
    } catch (error) {
      if (error instanceof NoSuchKey) return null;
      throw error;
    }
  }

  /** Removes the file; S3 treats a missing key as success. */
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }

  /** A presigned GET or PUT link that expires. */
  async signedUrl(key: string, { method, expiresInSeconds, contentType }: SignedUrlOptions): Promise<string> {
    const command =
      method === "put"
        ? new PutObjectCommand({ Bucket: this.options.bucket, Key: key, ContentType: contentType })
        : new GetObjectCommand({ Bucket: this.options.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}
