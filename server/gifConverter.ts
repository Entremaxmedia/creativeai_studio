import { spawn } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { objectStorageClient } from './objectStorage';

export interface ConversionOptions {
  sourceVideoUrl: string;
  outputFormat: 'gif' | 'webp';
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
  startTime?: number;
  endTime?: number;
  quality?: number; // 1-100
  fps?: number;
  width?: number;
  height?: number;
  loop?: number; // 0 = infinite, 1+ = specific loop count
}

export interface ConversionResult {
  outputPath: string;
  fileSize: number;
  duration: number;
}

interface VideoInfo {
  width: number;
  height: number;
  duration: number;
}

// Get video metadata using ffprobe
async function getVideoInfo(inputPath: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,duration',
      '-of', 'json',
      inputPath
    ];

    const ffprobe = spawn('ffprobe', args);
    let output = '';
    let errorOutput = '';

    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed: ${errorOutput}`));
        return;
      }

      try {
        const info = JSON.parse(output);
        const stream = info.streams[0];
        resolve({
          width: stream.width,
          height: stream.height,
          duration: parseFloat(stream.duration) || 0
        });
      } catch (error) {
        reject(new Error(`Failed to parse ffprobe output: ${error}`));
      }
    });
  });
}

// Download video from URL to temporary file or resolve local path
async function downloadVideo(url: string): Promise<string> {
  // Handle session IDs from chunked uploads (local temp files)
  if (url.startsWith('session:')) {
    const sessionId = url.replace('session:', '');
    const { getSessionTempPath } = await import('./objectStorage');
    const tempPath = await getSessionTempPath(sessionId);
    
    if (!tempPath || !existsSync(tempPath)) {
      throw new Error(`Your video upload session has expired. Please re-upload your video to continue.`);
    }
    
    console.log(`[GIF Converter] Using local temp file from session: ${sessionId} -> ${tempPath}`);
    return tempPath;
  }
  
  const tempDir = path.join(process.cwd(), 'tmp');
  if (!existsSync(tempDir)) {
    await mkdir(tempDir, { recursive: true });
  }

  // Normalize local paths - add leading slash if missing for relative paths
  let normalizedUrl = url;
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('/')) {
    normalizedUrl = '/' + url;
  }

  // If URL is a local server path (starts with /), resolve to filesystem path or download from storage
  if (normalizedUrl.startsWith('/')) {
    // Handle object storage URLs
    if (normalizedUrl.startsWith('/storage/')) {
      const privateObjectDir = process.env.PRIVATE_OBJECT_DIR || "";
      if (!privateObjectDir) {
        throw new Error("PRIVATE_OBJECT_DIR not set");
      }

      // Extract object ID from URL (e.g., "/storage/abc-123.mp4" -> "abc-123.mp4")
      const objectId = normalizedUrl.replace('/storage/', '');
      const fullPath = `${privateObjectDir}/generated/${objectId}`;
      
      // Parse bucket and object name
      const pathParts = fullPath.split("/");
      const bucketName = pathParts[1];
      const objectName = pathParts.slice(2).join("/");
      
      // Download from object storage to temp file
      const tempPath = path.join(tempDir, `storage-${randomUUID()}.mp4`);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);
      
      await file.download({ destination: tempPath });
      console.log(`[GIF Converter] Downloaded from storage: ${objectId} -> ${tempPath}`);
      return tempPath;
    }
    
    // Map server URLs to their actual filesystem locations
    // Strip leading slash before joining to avoid path.join treating it as absolute
    const relativePath = normalizedUrl.substring(1); // Remove leading /
    
    if (normalizedUrl.startsWith('/gif-conversions/')) {
      return path.join(process.cwd(), 'public', relativePath);
    } else if (normalizedUrl.startsWith('/generated-videos/')) {
      return path.join(process.cwd(), 'generated_videos', relativePath.replace('generated-videos/', ''));
    } else if (normalizedUrl.startsWith('/uploads/')) {
      return path.join(process.cwd(), 'uploads', relativePath.replace('uploads/', ''));
    } else {
      // Default: assume it's in the public directory
      return path.join(process.cwd(), 'public', relativePath);
    }
  }

  const tempPath = path.join(tempDir, `input-${randomUUID()}.mp4`);
  
  // Otherwise, download from URL
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  await writeFile(tempPath, Buffer.from(buffer));
  return tempPath;
}

// Convert video to GIF or WebP
export async function convertVideo(options: ConversionOptions): Promise<ConversionResult> {
  const {
    sourceVideoUrl,
    outputFormat,
    cropX = 0,
    cropY = 0,
    cropWidth,
    cropHeight,
    startTime = 0,
    endTime,
    quality = 80,
    fps = 15,
    width,
    height,
    loop = 0
  } = options;

  let inputPath: string | null = null;
  let tempInput = false;

  try {
    // Download or get input video
    inputPath = await downloadVideo(sourceVideoUrl);
    // Only cleanup downloaded temp files, NOT session files (those persist for re-conversion)
    tempInput = !sourceVideoUrl.startsWith('/') && !sourceVideoUrl.startsWith('session:');

    // Get video info
    const videoInfo = await getVideoInfo(inputPath);
    const actualEndTime = endTime || videoInfo.duration;
    const outputDuration = actualEndTime - startTime;

    // Prepare output directory
    const outputDir = path.join(process.cwd(), 'public', 'gif-conversions');
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }

    const outputFileName = `${randomUUID()}.${outputFormat}`;
    const outputPath = path.join(outputDir, outputFileName);

    // Build ffmpeg filter chain
    // Order: crop → scale → fps → mpdecimate → setpts
    const filters: string[] = [];

    // Trim video if needed
    let inputOptions: string[] = [];
    if (startTime > 0) {
      inputOptions.push('-ss', startTime.toString());
    }
    if (endTime) {
      inputOptions.push('-to', endTime.toString());
    }

    // 1. Crop filter
    const actualCropWidth = cropWidth || videoInfo.width;
    const actualCropHeight = cropHeight || videoInfo.height;
    if (cropX > 0 || cropY > 0 || cropWidth || cropHeight) {
      filters.push(`crop=${actualCropWidth}:${actualCropHeight}:${cropX}:${cropY}`);
    }

    // 2. Scale filter
    if (width || height) {
      const scaleW = width || -1;
      const scaleH = height || -1;
      filters.push(`scale=${scaleW}:${scaleH}:flags=lanczos`);
    }

    // 3. FPS filter
    filters.push(`fps=${fps}`);
    
    // 4. Drop near-duplicate frames (skip at very low quality to prevent pacing jumps)
    if (quality >= 35 && outputFormat === 'gif') {
      const hi = 64 * (6 + quality / 20);
      const lo = Math.round(hi * 0.35);
      const frac = quality > 75 ? 0.33 : 0.2;
      filters.push(`mpdecimate=hi=${Math.round(hi)}:lo=${lo}:frac=${frac}`);
      filters.push(`setpts=N/(FRAME_RATE*TB)`); // Renormalize timestamps
    }

    // Build ffmpeg command based on output format
    let ffmpegArgs: string[] = [...inputOptions, '-i', inputPath];

    if (outputFormat === 'gif') {
      // GIF conversion with palette generation for better quality
      const palettegenFilters = filters.join(',');
      const paletteFile = path.join(outputDir, `palette-${randomUUID()}.png`);
      
      // Dynamic palette colors based on quality (32-256 colors)
      const maxColors = Math.min(256, Math.round(32 + quality * 1.92));
      
      // Generate palette
      const paletteArgs = [
        ...inputOptions,
        '-i', inputPath,
        '-vf', `${palettegenFilters},palettegen=stats_mode=diff:max_colors=${maxColors}`,
        '-y',
        paletteFile
      ];

      await new Promise<void>((resolve, reject) => {
        const paletteProcess = spawn('ffmpeg', paletteArgs);
        let errorOutput = '';

        paletteProcess.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });

        paletteProcess.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`Palette generation failed: ${errorOutput}`));
          } else {
            resolve();
          }
        });
      });

      // Use palette to create GIF with quality-based dithering
      // Tiered dithering: sierra2_4a (high), bayer (medium), none (low)
      let ditherSettings: string;
      if (quality >= 75) {
        ditherSettings = 'dither=sierra2_4a'; // Best gradients for high quality
      } else if (quality >= 45) {
        ditherSettings = 'dither=bayer:bayer_scale=2'; // Moderate dithering
      } else {
        ditherSettings = 'dither=none'; // No dithering for coarse palettes
      }
      
      const gifFilters = `${filters.join(',')},paletteuse=${ditherSettings}`;
      ffmpegArgs = [
        ...inputOptions,
        '-i', inputPath,
        '-i', paletteFile,
        '-lavfi', gifFilters,
        '-loop', (loop === 0 ? 0 : loop === 1 ? -1 : loop - 1).toString(),
        '-y',
        outputPath
      ];

      await new Promise<void>((resolve, reject) => {
        const gifProcess = spawn('ffmpeg', ffmpegArgs);
        let errorOutput = '';

        gifProcess.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });

        gifProcess.on('close', async (code) => {
          // Clean up palette file
          try {
            await unlink(paletteFile);
          } catch (e) {
            // Ignore cleanup errors
          }

          if (code !== 0) {
            reject(new Error(`GIF conversion failed: ${errorOutput}`));
          } else {
            resolve();
          }
        });
      });
    } else {
      // WebP conversion with loop support
      const webpFilters = filters.join(',');
      const webpQuality = Math.floor((quality / 100) * 100); // Map 1-100 to WebP quality scale
      
      // More aggressive compression for smaller files
      const alphaQuality = Math.max(0, webpQuality - 20); // Lossy alpha for smaller files

      ffmpegArgs = [
        ...ffmpegArgs,
        '-vf', webpFilters,
        '-c:v', 'libwebp',
        '-pix_fmt', 'yuva420p', // Better compression with alpha support
        '-quality', webpQuality.toString(),
        '-compression_level', '6',
        '-loop', loop.toString(),
        '-preset', 'picture', // More aggressive rate control
        '-y',
        outputPath
      ];

      await new Promise<void>((resolve, reject) => {
        const webpProcess = spawn('ffmpeg', ffmpegArgs);
        let errorOutput = '';

        webpProcess.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });

        webpProcess.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`WebP conversion failed: ${errorOutput}`));
          } else {
            resolve();
          }
        });
      });
    }

    // Get file size
    const { stat } = await import('fs/promises');
    const stats = await stat(outputPath);
    const fileSize = stats.size;

    // Clean up temp input if it was downloaded
    if (tempInput && inputPath) {
      try {
        await unlink(inputPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    return {
      outputPath: `/gif-conversions/${outputFileName}`,
      fileSize,
      duration: outputDuration
    };
  } catch (error) {
    // Clean up on error
    if (tempInput && inputPath) {
      try {
        await unlink(inputPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    throw error;
  }
}

// Estimate file size without actually converting
export async function estimateFileSize(options: ConversionOptions): Promise<number> {
  const {
    outputFormat,
    cropWidth,
    cropHeight,
    startTime = 0,
    endTime,
    quality = 80,
    fps = 15,
    width,
    height,
    sourceVideoUrl
  } = options;

  // Download or get input video
  const inputPath = await downloadVideo(sourceVideoUrl);
  // Only cleanup downloaded temp files, NOT session files (those are cleaned up after conversion)
  const tempInput = !sourceVideoUrl.startsWith('/') && !sourceVideoUrl.startsWith('session:');

  try {
    const videoInfo = await getVideoInfo(inputPath);
    const actualEndTime = endTime || videoInfo.duration;
    const outputDuration = actualEndTime - startTime;

    // Calculate dimensions
    const actualCropWidth = cropWidth || videoInfo.width;
    const actualCropHeight = cropHeight || videoInfo.height;
    const outputWidth = width || actualCropWidth;
    const outputHeight = height || actualCropHeight;

    // Estimate based on format, resolution, duration, fps, and quality
    // Using more conservative estimates based on actual compression
    const pixels = outputWidth * outputHeight;
    const frames = outputDuration * fps;

    let bytesPerFrame: number;
    if (outputFormat === 'gif') {
      // GIF: More realistic estimate accounting for palette compression
      // Roughly 0.1-0.5 bytes per pixel per frame depending on quality
      const qualityFactor = (quality / 100) * 0.4 + 0.1; // 0.1 to 0.5
      bytesPerFrame = pixels * qualityFactor;
    } else {
      // WebP: Very efficient compression, roughly 0.03-0.15 bytes per pixel per frame
      const qualityFactor = (quality / 100) * 0.12 + 0.03; // 0.03 to 0.15
      bytesPerFrame = pixels * qualityFactor;
    }

    const estimatedSize = Math.floor(bytesPerFrame * frames);

    // Clean up temp input if needed (but NOT session files - those are cleaned up after final conversion)
    if (tempInput) {
      try {
        await unlink(inputPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    return estimatedSize;
  } catch (error) {
    if (tempInput) {
      try {
        await unlink(inputPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    throw error;
  }
}
