// Simple object storage utilities for AI-generated content
// Reference: blueprint:javascript_object_storage
import { Storage, File } from "@google-cloud/storage";
import { Response } from "express";
import { randomUUID } from "crypto";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

// Object storage client for Replit App Storage
export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

/**
 * Upload a buffer (video or image) to object storage
 * Returns the public URL to access the file
 */
export async function uploadToStorage(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  const privateObjectDir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!privateObjectDir) {
    throw new Error("PRIVATE_OBJECT_DIR not set");
  }

  const objectId = randomUUID();
  const extension = filename.split('.').pop() || 'bin';
  const fullPath = `${privateObjectDir}/generated/${objectId}.${extension}`;

  const { bucketName, objectName } = parseObjectPath(fullPath);
  const bucket = objectStorageClient.bucket(bucketName);
  const file = bucket.file(objectName);

  await file.save(buffer, {
    contentType,
    metadata: {
      originalName: filename,
    },
  });

  // Return path for retrieval
  return `/storage/${objectId}.${extension}`;
}

/**
 * Create upload session for chunked uploads
 * Returns session ID and storage URL for the final file
 */
export async function createUploadSession(
  filename: string,
  contentType: string
): Promise<{ sessionId: string; storageUrl: string }> {
  const privateObjectDir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!privateObjectDir) {
    throw new Error("PRIVATE_OBJECT_DIR not set");
  }

  const sessionId = randomUUID();
  const extension = filename.split('.').pop() || 'bin';
  const storageUrl = `/storage/${sessionId}.${extension}`;

  return {
    sessionId,
    storageUrl,
  };
}

// Local temp file storage for chunked uploads (avoids GCS eventual consistency issues)
import { appendFile, writeFile as fsWriteFile, stat, unlink, readFile } from 'fs/promises';
import { mkdirSync, existsSync } from 'fs';
import pathModule from 'path';

// Track session metadata with timestamp for TTL-based cleanup
interface SessionMetadata {
  tempPath: string;
  filename: string;
  contentType: string;
  createdAt: number; // Unix timestamp in milliseconds
}

const sessionMetadata = new Map<string, SessionMetadata>();

/**
 * Save session metadata to a JSON sidecar file
 */
async function saveSessionMetadata(sessionId: string, metadata: SessionMetadata): Promise<void> {
  const metadataPath = pathModule.join('/tmp/gif-sessions', `${sessionId}.meta.json`);
  await fsWriteFile(metadataPath, JSON.stringify(metadata, null, 2));
}

/**
 * Load session metadata from a JSON sidecar file
 */
async function loadSessionMetadata(sessionId: string): Promise<SessionMetadata | null> {
  const metadataPath = pathModule.join('/tmp/gif-sessions', `${sessionId}.meta.json`);
  if (!existsSync(metadataPath)) {
    return null;
  }
  try {
    const content = await readFile(metadataPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`[GIF Upload] Failed to load metadata for session ${sessionId}:`, error);
    return null;
  }
}

/**
 * Upload a chunk to local temp storage
 * Chunks are appended to a local file, avoiding GCS eventual consistency issues
 */
export async function uploadChunk(
  sessionId: string,
  chunk: Buffer,
  chunkIndex: number,
  isLastChunk: boolean,
  filename: string,
  contentType: string
): Promise<void> {
  // Create sessions directory in system temp
  const sessionsDir = '/tmp/gif-sessions';
  if (!existsSync(sessionsDir)) {
    mkdirSync(sessionsDir, { recursive: true });
  }
  
  const extension = filename.split('.').pop() || 'bin';
  const tempPath = pathModule.join(sessionsDir, `${sessionId}.${extension}`);
  
  // Store session metadata in memory and persist to disk (update on every chunk to ensure consistency)
  // Preserve existing createdAt if session already exists, otherwise use current time
  const existingMetadata = sessionMetadata.get(sessionId);
  const metadata: SessionMetadata = { 
    tempPath, 
    filename, 
    contentType, 
    createdAt: existingMetadata?.createdAt || Date.now() 
  };
  sessionMetadata.set(sessionId, metadata);
  await saveSessionMetadata(sessionId, metadata);
  
  if (chunkIndex === 0) {
    console.log(`[GIF Upload] Created new session ${sessionId} -> ${tempPath}`);
  }
  
  // Append chunk to local file
  if (chunkIndex === 0) {
    // First chunk - write new file
    await fsWriteFile(tempPath, chunk);
    console.log(`[GIF Upload] Wrote chunk 0 for session ${sessionId} (${chunk.length} bytes)`);
  } else {
    // Subsequent chunks - append to existing file
    await appendFile(tempPath, chunk);
    console.log(`[GIF Upload] Appended chunk ${chunkIndex} for session ${sessionId} (${chunk.length} bytes)`);
  }
  
  // If this is the last chunk, log completion
  if (isLastChunk) {
    const stats = await stat(tempPath);
    console.log(`[GIF Upload] Upload complete for session ${sessionId}, total size: ${(stats.size / (1024 * 1024)).toFixed(2)}MB at ${tempPath}`);
  }
}

/**
 * Get the full session metadata (tempPath, filename, contentType, createdAt)
 * If not in memory, attempts to reconstruct from filesystem metadata
 */
export async function getSessionMetadata(sessionId: string): Promise<SessionMetadata | null> {
  // Check memory first
  const metadata = sessionMetadata.get(sessionId);
  if (metadata) {
    return metadata;
  }
  
  // Not in memory - try to load from metadata file
  const loadedMetadata = await loadSessionMetadata(sessionId);
  if (loadedMetadata && existsSync(loadedMetadata.tempPath)) {
    // Cache in memory for faster subsequent access
    sessionMetadata.set(sessionId, loadedMetadata);
    console.log(`[GIF Upload] Reconstructed session ${sessionId} from metadata file -> ${loadedMetadata.tempPath}`);
    return loadedMetadata;
  }
  
  return null;
}

/**
 * Get the local temp file path for a session
 * If not in memory, attempts to reconstruct from filesystem metadata
 */
export async function getSessionTempPath(sessionId: string): Promise<string | null> {
  const metadata = await getSessionMetadata(sessionId);
  return metadata?.tempPath || null;
}

/**
 * Clean up a session's temp file and metadata
 */
export async function cleanupSession(sessionId: string): Promise<void> {
  // Load metadata if not in memory
  let metadata = sessionMetadata.get(sessionId);
  if (!metadata) {
    const loadedMetadata = await loadSessionMetadata(sessionId);
    if (loadedMetadata) {
      metadata = loadedMetadata;
    }
  }
  
  if (metadata) {
    try {
      // Delete temp file
      if (existsSync(metadata.tempPath)) {
        await unlink(metadata.tempPath);
        console.log(`[GIF Upload] Cleaned up temp file: ${metadata.tempPath}`);
      }
      
      // Delete metadata file
      const metadataPath = pathModule.join('/tmp/gif-sessions', `${sessionId}.meta.json`);
      if (existsSync(metadataPath)) {
        await unlink(metadataPath);
        console.log(`[GIF Upload] Cleaned up metadata file: ${metadataPath}`);
      }
      
      sessionMetadata.delete(sessionId);
      console.log(`[GIF Upload] Cleaned up session ${sessionId}`);
    } catch (error: any) {
      console.error(`[GIF Upload] Failed to cleanup session ${sessionId}:`, error.message);
    }
  }
}

/**
 * Clean up stale sessions older than the specified age (default 1 hour)
 * Called on server startup and periodically to prevent disk space accumulation
 */
export async function cleanupStaleSessions(maxAgeMs: number = 60 * 60 * 1000): Promise<void> {
  const sessionsDir = '/tmp/gif-sessions';
  if (!existsSync(sessionsDir)) {
    return;
  }
  
  const now = Date.now();
  let cleanedCount = 0;
  
  try {
    const { readdir } = await import('fs/promises');
    const files = await readdir(sessionsDir);
    
    // Find all metadata files
    const metadataFiles = files.filter(f => f.endsWith('.meta.json'));
    
    for (const metaFile of metadataFiles) {
      const sessionId = metaFile.replace('.meta.json', '');
      const metadata = await loadSessionMetadata(sessionId);
      
      if (metadata && metadata.createdAt) {
        const age = now - metadata.createdAt;
        if (age > maxAgeMs) {
          console.log(`[GIF Upload] Cleaning up stale session ${sessionId} (age: ${(age / (1000 * 60 * 60)).toFixed(1)}h)`);
          await cleanupSession(sessionId);
          cleanedCount++;
        }
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`[GIF Upload] Cleaned up ${cleanedCount} stale session(s)`);
    }
  } catch (error: any) {
    console.error('[GIF Upload] Error during stale session cleanup:', error.message);
  }
}

/**
 * Download a file from storage and stream it to response
 * Supports HTTP Range requests for video streaming
 */
export async function downloadFromStorage(
  objectId: string,
  res: Response,
  rangeHeader?: string
): Promise<void> {
  try {
    const privateObjectDir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!privateObjectDir) {
      throw new Error("PRIVATE_OBJECT_DIR not set");
    }

    const fullPath = `${privateObjectDir}/generated/${objectId}`;
    console.log(`[Storage Download] Attempting to download: ${fullPath}`);
    
    const { bucketName, objectName } = parseObjectPath(fullPath);
    console.log(`[Storage Download] Parsed as bucket: ${bucketName}, object: ${objectName}`);
    
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);

    // Retry logic for file existence (handles eventual consistency in object storage)
    let exists = false;
    let retries = 0;
    const maxRetries = 3;
    const retryDelay = 500; // 500ms
    
    while (!exists && retries < maxRetries) {
      [exists] = await file.exists();
      if (!exists && retries < maxRetries - 1) {
        console.log(`[Storage Download] File not found yet, retrying in ${retryDelay}ms (attempt ${retries + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        retries++;
      } else {
        break;
      }
    }
    
    if (!exists) {
      console.error(`[Storage Download] File not found after ${maxRetries} retries: ${bucketName}/${objectName}`);
      res.status(404).send("File not found");
      return;
    }
    
    console.log(`[Storage Download] File exists, serving: ${objectId}`);

    // Small delay to allow storage to finalize (helps with eventual consistency in production)
    if (retries > 0) {
      console.log(`[Storage Download] File found after retries, adding 200ms safety delay`);
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Get file metadata with explicit error handling
    console.log(`[Storage Download] Fetching metadata for ${bucketName}/${objectName}`);
    let metadata;
    try {
      [metadata] = await file.getMetadata();
      console.log(`[Storage Download] Metadata retrieved successfully`);
    } catch (metadataError: any) {
      console.error(`[Storage Download] Failed to get metadata:`, metadataError);
      throw new Error(`Failed to get file metadata: ${metadataError.message}`);
    }
    
    const fileSize = typeof metadata.size === 'number' ? metadata.size : parseInt(metadata.size || '0');
    const contentType = metadata.contentType || "application/octet-stream";

    console.log(`[Storage Download] File metadata - size: ${fileSize}, type: ${contentType}`);

    // For freshly uploaded files, add longer delay for eventual consistency
    console.log(`[Storage Download] Adding 5-second delay for storage stabilization`);
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log(`[Storage Download] Delay complete, proceeding with stream`);

    // Stream the file
    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;

      console.log(`[Storage Download] Streaming range ${start}-${end} (${chunkSize} bytes)`);

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000",
      });

      const stream = file.createReadStream({ start, end });
      
      stream.on('error', (streamError) => {
        console.error('[Storage Download] Stream error:', streamError);
        res.end();
      });

      stream.on('end', () => {
        console.log(`[Storage Download] Stream completed successfully`);
      });
      
      stream.pipe(res);
    } else {
      console.log(`[Storage Download] Streaming full file (${fileSize} bytes)`);

      res.set({
        "Content-Type": contentType,
        "Content-Length": fileSize.toString(),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000",
      });

      const stream = file.createReadStream();
      
      stream.on('error', (streamError) => {
        console.error('[Storage Download] Stream error:', streamError);
        res.end();
      });

      stream.on('end', () => {
        console.log(`[Storage Download] Stream completed successfully`);
      });
      
      stream.pipe(res);
    }
  } catch (error: any) {
    console.error("[Storage Download] Error:", error);
    console.error("[Storage Download] Error details:", {
      message: error.message,
      stack: error.stack,
      code: error.code,
      objectId
    });
    if (!res.headersSent) {
      res.status(500).send(`Download error: ${error.message}`);
    }
  }
}
