/**
 * Storage Cache Utility
 * 
 * Manages localStorage caching for AI-generated videos and images.
 * Instead of storing large base64 data in localStorage (which causes quota errors),
 * this utility:
 * 1. Uploads content to App Storage (cloud)
 * 2. Stores small metadata + storage path in localStorage
 * 3. Retrieves content from storage on demand
 */

const VIDEOS_CACHE_KEY = 'generatedVideosCache';
const IMAGES_CACHE_KEY = 'generatedImagesCache';

export interface CachedVideo {
  storagePath: string;
  modelName: string;
  variationIndex: number;
  prompt: string;
  generationType: string;
  duration: number;
  aspectRatio: string;
  productId: string;
  timestamp: number;
}

export interface CachedImage {
  storagePath: string;
  provider: string;
  prompt: string;
  productId: string;
  timestamp: number;
}

/**
 * Upload base64 data to cloud storage
 * Returns the storage path for retrieval
 */
export async function uploadToStorage(
  base64Data: string,
  filename: string,
  contentType: string
): Promise<string> {
  const response = await fetch('/api/storage/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: base64Data, filename, contentType }),
  });

  if (!response.ok) {
    throw new Error('Failed to upload to storage');
  }

  const { storagePath } = await response.json();
  return storagePath;
}

/**
 * Retrieve content from cloud storage
 * Returns the full URL to the stored content
 */
export function getStorageUrl(storagePath: string): string {
  return storagePath; // Path is already in the format /storage/xxx
}

// === VIDEO CACHE FUNCTIONS ===

/**
 * Save video metadata to localStorage cache
 */
export function cacheVideo(modelId: string, video: CachedVideo): void {
  try {
    const cache = getVideoCache();
    if (!cache[modelId]) {
      cache[modelId] = [];
    }
    cache[modelId].push(video);
    localStorage.setItem(VIDEOS_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error('Failed to cache video:', error);
  }
}

/**
 * Get all cached videos from localStorage
 */
export function getVideoCache(): Record<string, CachedVideo[]> {
  try {
    const stored = localStorage.getItem(VIDEOS_CACHE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error('Failed to load video cache:', error);
    return {};
  }
}

/**
 * Clear video cache (when starting new generation)
 */
export function clearVideoCache(): void {
  try {
    localStorage.removeItem(VIDEOS_CACHE_KEY);
  } catch (error) {
    console.error('Failed to clear video cache:', error);
  }
}

// === IMAGE CACHE FUNCTIONS ===

/**
 * Save image metadata to localStorage cache
 */
export function cacheImage(provider: string, image: CachedImage): void {
  try {
    const cache = getImageCache();
    if (!cache[provider]) {
      cache[provider] = [];
    }
    cache[provider].push(image);
    localStorage.setItem(IMAGES_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error('Failed to cache image:', error);
  }
}

/**
 * Get all cached images from localStorage
 */
export function getImageCache(): Record<string, CachedImage[]> {
  try {
    const stored = localStorage.getItem(IMAGES_CACHE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error('Failed to load image cache:', error);
    return {};
  }
}

/**
 * Clear image cache (when starting new generation)
 */
export function clearImageCache(): void {
  try {
    localStorage.removeItem(IMAGES_CACHE_KEY);
  } catch (error) {
    console.error('Failed to clear image cache:', error);
  }
}
