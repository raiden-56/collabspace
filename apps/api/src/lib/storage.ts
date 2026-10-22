import fs from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";
import { logger } from "./logger.js";

export interface StorageDriver {
  readonly name: string;
  put(key: string, body: Buffer | Readable, contentType: string, size?: number): Promise<void>;
  getStream(key: string): Promise<{ stream: Readable; contentType?: string; size?: number } | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** A URL a browser can fetch directly, or null if the API must proxy. */
  signedDownloadUrl(key: string, fileName: string, contentType: string, ttlSeconds: number): Promise<string | null>;
}

class LocalStorage implements StorageDriver {
  readonly name = "local";
  private root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }
  private resolve(key: string): string {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root)) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, body: Buffer | Readable): Promise<void> {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    if (Buffer.isBuffer(body)) await fs.writeFile(p, body);
    else {
      const chunks: Buffer[] = [];
      for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      await fs.writeFile(p, Buffer.concat(chunks));
    }
  }
  async getStream(key: string) {
    const p = this.resolve(key);
    if (!existsSync(p)) return null;
    const stat = await fs.stat(p);
    return { stream: createReadStream(p), size: stat.size };
  }
  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }
  async exists(key: string): Promise<boolean> {
    return existsSync(this.resolve(key));
  }
  async signedDownloadUrl(): Promise<string | null> {
    return null;
  }
}

class S3Storage implements StorageDriver {
  readonly name = "s3";
  private client: S3Client;
  private bucket: string;
  constructor() {
    if (!config.S3_BUCKET || !config.S3_ACCESS_KEY || !config.S3_SECRET_KEY) throw new Error("S3 storage requires S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY");
    this.bucket = config.S3_BUCKET;
    this.client = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
    });
  }
  async put(key: string, body: Buffer | Readable, contentType: string, size?: number): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ContentLength: size }));
  }
  async getStream(key: string) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) return null;
      return { stream: res.Body as Readable, contentType: res.ContentType, size: res.ContentLength };
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
  async signedDownloadUrl(key: string, fileName: string, contentType: string, ttlSeconds: number): Promise<string | null> {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      ResponseContentType: contentType,
    });
    return getSignedUrl(this.client, cmd, { expiresIn: ttlSeconds });
  }
}

let driver: StorageDriver | undefined;

export function storage(): StorageDriver {
  if (driver) return driver;
  if (config.STORAGE_DRIVER === "s3") {
    try {
      driver = new S3Storage();
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "S3 not configured, falling back to local storage");
      driver = new LocalStorage(config.LOCAL_UPLOAD_DIR);
    }
  } else {
    driver = new LocalStorage(config.LOCAL_UPLOAD_DIR);
  }
  return driver;
}

export const ALLOWED_MIME_PREFIXES = ["image/", "video/", "audio/", "text/"];
export const ALLOWED_MIME_EXACT = new Set([
  "application/pdf",
  "application/json",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "text/csv",
  "text/markdown",
  "application/octet-stream",
]);
export const BLOCKED_MIME = new Set(["text/html", "application/xhtml+xml", "image/svg+xml", "application/javascript", "text/javascript"]);

export function isAllowedMime(mime: string): boolean {
  const m = mime.toLowerCase().split(";")[0]!.trim();
  if (BLOCKED_MIME.has(m)) return false;
  if (ALLOWED_MIME_EXACT.has(m)) return true;
  return ALLOWED_MIME_PREFIXES.some((p) => m.startsWith(p));
}
